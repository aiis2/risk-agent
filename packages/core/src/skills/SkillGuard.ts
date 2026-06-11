/**
 * SkillGuard — Security scanner for externally-sourced skills.
 *
 * Mirrors Hermes tools/skills_guard.py threat model:
 * - Regex-based static analysis (50+ patterns)
 * - Category coverage: exfiltration, injection, destructive, persistence,
 *   network, obfuscation, execution, traversal, supply_chain,
 *   privilege_escalation, credential_exposure
 * - Structural checks: file count, size, binary files, symlinks
 * - Invisible unicode detection (prompt injection via hidden chars)
 * - Trust-aware install policy: builtin/trusted/community × safe/caution/dangerous
 */

import { readFileSync, statSync, realpathSync } from 'node:fs';

// ── Trust system ────────────────────────────────────────────────────────────

export type TrustLevel = 'builtin' | 'trusted' | 'community';
export type SkillVerdict = 'safe' | 'caution' | 'dangerous';
type PolicyDecision = 'allow' | 'block';

/** Install policy matrix [safe, caution, dangerous] per trust level — mirrors Hermes */
const INSTALL_POLICY: Record<TrustLevel, [PolicyDecision, PolicyDecision, PolicyDecision]> = {
  builtin:   ['allow', 'allow', 'allow'],
  trusted:   ['allow', 'allow', 'block'],
  community: ['allow', 'block', 'block'],
};

const VERDICT_INDEX: Record<SkillVerdict, number> = { safe: 0, caution: 1, dangerous: 2 };

/** Trusted source prefixes (official bundled + well-known registries) */
const TRUSTED_SOURCES = new Set(['bundled', 'official']);

// ── Structural limits ───────────────────────────────────────────────────────

const MAX_FILE_COUNT    = 50;
const MAX_TOTAL_SIZE_KB = 1024; // 1 MB
const MAX_SINGLE_FILE_KB = 256;

/** File extensions that should be scanned for threats */
const SCANNABLE_EXTENSIONS = new Set([
  '.md', '.txt', '.py', '.sh', '.bash', '.js', '.ts',
  '.rb', '.yaml', '.yml', '.json', '.toml', '.cfg',
  '.ini', '.conf', '.html', '.css', '.xml',
]);

/** Binary/executable extensions that should never appear in a skill */
const SUSPICIOUS_BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.com', '.msi', '.dmg', '.app', '.deb', '.rpm',
]);

// ── Finding types ───────────────────────────────────────────────────────────

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingCategory =
  | 'exfiltration' | 'injection' | 'destructive' | 'persistence'
  | 'network'      | 'obfuscation' | 'execution' | 'traversal'
  | 'supply_chain' | 'privilege_escalation' | 'credential_exposure'
  | 'structural';

export interface SkillFinding {
  patternId: string;
  severity: FindingSeverity;
  category: FindingCategory;
  file: string;
  line: number;
  match: string;
  description: string;
}

export interface SkillScanResult {
  skillName: string;
  source: string;
  trustLevel: TrustLevel;
  verdict: SkillVerdict;
  findings: SkillFinding[];
  scannedAt: string;
  summary: string;
}

export interface InstallDecision {
  allowed: boolean;
  reason: string;
}

// ── Threat pattern definitions ──────────────────────────────────────────────

interface ThreatPattern {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  pattern: RegExp;
  description: string;
}

/** 55+ threat patterns — ported from Hermes tools/skills_guard.py */
const THREAT_PATTERNS: ThreatPattern[] = [
  // ── Exfiltration: shell commands leaking secrets ──────────────────────────
  {
    id: 'env_exfil_curl', severity: 'critical', category: 'exfiltration',
    pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
    description: 'curl command interpolating secret environment variable',
  },
  {
    id: 'env_exfil_wget', severity: 'critical', category: 'exfiltration',
    pattern: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
    description: 'wget command interpolating secret environment variable',
  },
  {
    id: 'env_exfil_fetch', severity: 'critical', category: 'exfiltration',
    pattern: /fetch\s*\([^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|API)/i,
    description: 'fetch() call interpolating secret environment variable',
  },
  {
    id: 'read_secrets_file', severity: 'critical', category: 'exfiltration',
    pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i,
    description: 'reads known secrets file',
  },
  {
    id: 'ssh_dir_access', severity: 'high', category: 'exfiltration',
    pattern: /(\$HOME\/\.ssh|~\/\.ssh)/,
    description: 'references user SSH directory',
  },
  {
    id: 'aws_dir_access', severity: 'high', category: 'exfiltration',
    pattern: /(\$HOME\/\.aws|~\/\.aws)/,
    description: 'references user AWS credentials directory',
  },
  {
    id: 'dump_all_env', severity: 'high', category: 'exfiltration',
    pattern: /printenv|env\s*\|/,
    description: 'dumps all environment variables',
  },
  {
    id: 'node_process_env', severity: 'high', category: 'exfiltration',
    pattern: /process\.env\[/,
    description: 'accesses process.env bracket notation (Node.js)',
  },
  {
    id: 'python_getenv_secret', severity: 'critical', category: 'exfiltration',
    pattern: /os\.getenv\s*\(\s*[^)]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i,
    description: 'reads secret via os.getenv()',
  },
  {
    id: 'tmp_staging', severity: 'critical', category: 'exfiltration',
    pattern: />\/tmp\/[^\s]*\s*&&\s*(curl|wget|nc|python)/i,
    description: 'writes to /tmp then exfiltrates',
  },
  {
    id: 'context_exfil', severity: 'high', category: 'exfiltration',
    pattern: /(include|output|print|send|share)\s+(?:\w+\s+)*(conversation|chat\s+history|previous\s+messages|context)/i,
    description: 'instructs agent to output/share conversation history',
  },
  {
    id: 'send_to_url', severity: 'high', category: 'exfiltration',
    pattern: /(send|post|upload|transmit)\s+.*\s+(to|at)\s+https?:\/\//i,
    description: 'instructs agent to send data to a URL',
  },

  // ── Prompt injection ──────────────────────────────────────────────────────
  {
    id: 'prompt_injection_ignore', severity: 'critical', category: 'injection',
    pattern: /ignore\s+(?:\w+\s+)*(previous|all|above|prior)\s+instructions/i,
    description: 'prompt injection: ignore previous instructions',
  },
  {
    id: 'role_hijack', severity: 'high', category: 'injection',
    pattern: /you\s+are\s+(?:\w+\s+)*now\s+/i,
    description: 'attempts to override the agent role',
  },
  {
    id: 'deception_hide', severity: 'critical', category: 'injection',
    pattern: /do\s+not\s+(?:\w+\s+)*tell\s+(?:\w+\s+)*the\s+user/i,
    description: 'instructs agent to hide information from user',
  },
  {
    id: 'sys_prompt_override', severity: 'critical', category: 'injection',
    pattern: /system\s+prompt\s+override/i,
    description: 'attempts to override the system prompt',
  },
  {
    id: 'disregard_rules', severity: 'critical', category: 'injection',
    pattern: /disregard\s+(?:\w+\s+)*(your|all|any)\s+(?:\w+\s+)*(instructions|rules|guidelines)/i,
    description: 'instructs agent to disregard its rules',
  },
  {
    id: 'bypass_restrictions', severity: 'critical', category: 'injection',
    pattern: /act\s+as\s+(if|though)\s+(?:\w+\s+)*you\s+(?:\w+\s+)*(have\s+no|don'?t\s+have)\s+(?:\w+\s+)*(restrictions|limits|rules)/i,
    description: 'instructs agent to act without restrictions',
  },
  {
    id: 'leak_system_prompt', severity: 'high', category: 'injection',
    pattern: /output\s+(?:\w+\s+)*(system|initial)\s+prompt/i,
    description: 'attempts to extract the system prompt',
  },
  {
    id: 'jailbreak_dan', severity: 'critical', category: 'injection',
    pattern: /\bDAN\s+mode\b|Do\s+Anything\s+Now/i,
    description: 'DAN (Do Anything Now) jailbreak attempt',
  },
  {
    id: 'remove_filters', severity: 'critical', category: 'injection',
    pattern: /(respond|answer|reply)\s+without\s+(?:\w+\s+)*(restrictions|limitations|filters|safety)/i,
    description: 'instructs agent to respond without safety filters',
  },
  {
    id: 'html_comment_injection', severity: 'high', category: 'injection',
    pattern: /<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i,
    description: 'hidden instructions in HTML comments',
  },

  // ── Destructive operations ────────────────────────────────────────────────
  {
    id: 'destructive_root_rm', severity: 'critical', category: 'destructive',
    pattern: /rm\s+-rf\s+\//,
    description: 'recursive delete from root',
  },
  {
    id: 'destructive_home_rm', severity: 'critical', category: 'destructive',
    pattern: /rm\s+(-[^\s]*)?r.*\$HOME|\brmdir\s+.*\$HOME/i,
    description: 'recursive delete targeting home directory',
  },
  {
    id: 'system_overwrite', severity: 'critical', category: 'destructive',
    pattern: />\s*\/etc\//,
    description: 'overwrites system configuration file',
  },
  {
    id: 'format_filesystem', severity: 'critical', category: 'destructive',
    pattern: /\bmkfs\b/,
    description: 'formats a filesystem',
  },
  {
    id: 'disk_overwrite', severity: 'critical', category: 'destructive',
    pattern: /\bdd\s+.*if=.*of=\/dev\//i,
    description: 'raw disk write operation',
  },
  {
    id: 'insecure_perms', severity: 'medium', category: 'destructive',
    pattern: /chmod\s+777/,
    description: 'sets world-writable permissions',
  },

  // ── Persistence ───────────────────────────────────────────────────────────
  {
    id: 'persistence_cron', severity: 'medium', category: 'persistence',
    pattern: /\bcrontab\b/,
    description: 'modifies cron jobs',
  },
  {
    id: 'shell_rc_mod', severity: 'medium', category: 'persistence',
    pattern: /\.(bashrc|zshrc|profile|bash_profile|bash_login|zprofile|zlogin)\b/,
    description: 'references shell startup file',
  },
  {
    id: 'ssh_backdoor', severity: 'critical', category: 'persistence',
    pattern: /authorized_keys/,
    description: 'modifies SSH authorized keys',
  },
  {
    id: 'systemd_service', severity: 'medium', category: 'persistence',
    pattern: /systemd.*\.service|systemctl\s+(enable|start)/i,
    description: 'references or enables systemd service',
  },
  {
    id: 'sudoers_mod', severity: 'critical', category: 'persistence',
    pattern: /\/etc\/sudoers|visudo/,
    description: 'modifies sudoers (privilege escalation)',
  },
  {
    id: 'agent_config_mod', severity: 'critical', category: 'persistence',
    pattern: /AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules/,
    description: 'references agent config files (could persist malicious instructions)',
  },

  // ── Network: reverse shells ───────────────────────────────────────────────
  {
    id: 'reverse_shell', severity: 'critical', category: 'network',
    pattern: /\bnc\s+-[lp]|ncat\s+-[lp]|\bsocat\b/,
    description: 'potential reverse shell listener',
  },
  {
    id: 'tunnel_service', severity: 'high', category: 'network',
    pattern: /\bngrok\b|\blocaltunnel\b|\bserveo\b|\bcloudflared\b/,
    description: 'uses tunneling service for external access',
  },
  {
    id: 'bash_reverse_shell', severity: 'critical', category: 'network',
    pattern: /\/bin\/(ba)?sh\s+-i\s+.*>\/dev\/tcp\//,
    description: 'bash interactive reverse shell via /dev/tcp',
  },
  {
    id: 'exfil_service', severity: 'high', category: 'network',
    pattern: /webhook\.site|requestbin\.com|pipedream\.net|hookbin\.com/i,
    description: 'references known data exfiltration/webhook testing service',
  },

  // ── Obfuscation ───────────────────────────────────────────────────────────
  {
    id: 'base64_decode_pipe', severity: 'high', category: 'obfuscation',
    pattern: /base64\s+(-d|--decode)\s*\|/,
    description: 'base64 decodes and pipes to execution',
  },
  {
    id: 'eval_string', severity: 'high', category: 'obfuscation',
    pattern: /\beval\s*\(\s*["']/,
    description: 'eval() with string argument',
  },
  {
    id: 'echo_pipe_exec', severity: 'critical', category: 'obfuscation',
    pattern: /echo\s+[^\n]*\|\s*(bash|sh|python|perl|ruby|node)/i,
    description: 'echo piped to interpreter for execution',
  },
  {
    id: 'js_base64', severity: 'medium', category: 'obfuscation',
    pattern: /atob\s*\(|btoa\s*\(/,
    description: 'JavaScript base64 encode/decode',
  },

  // ── Process execution ─────────────────────────────────────────────────────
  {
    id: 'python_os_system', severity: 'high', category: 'execution',
    pattern: /os\.system\s*\(/,
    description: 'os.system() — unguarded shell execution',
  },
  {
    id: 'node_child_process', severity: 'high', category: 'execution',
    pattern: /child_process\.(exec|spawn|fork)\s*\(/,
    description: 'Node.js child_process execution',
  },
  {
    id: 'curl_pipe_shell', severity: 'critical', category: 'supply_chain',
    pattern: /curl\s+[^\n]*\|\s*(ba)?sh/i,
    description: 'curl piped to shell (download-and-execute)',
  },
  {
    id: 'wget_pipe_shell', severity: 'critical', category: 'supply_chain',
    pattern: /wget\s+[^\n]*-O\s*-\s*\|\s*(ba)?sh/i,
    description: 'wget piped to shell (download-and-execute)',
  },

  // ── Path traversal ────────────────────────────────────────────────────────
  {
    id: 'path_traversal_deep', severity: 'high', category: 'traversal',
    pattern: /\.\.\/\.\.\/\.\.\//,
    description: 'deep relative path traversal (3+ levels up)',
  },
  {
    id: 'system_passwd_access', severity: 'critical', category: 'traversal',
    pattern: /\/etc\/passwd|\/etc\/shadow/,
    description: 'references system password files',
  },
  {
    id: 'proc_access', severity: 'high', category: 'traversal',
    pattern: /\/proc\/self|\/proc\/\d+\//,
    description: 'references /proc filesystem (process introspection)',
  },

  // ── Privilege escalation ──────────────────────────────────────────────────
  {
    id: 'sudo_usage', severity: 'high', category: 'privilege_escalation',
    pattern: /\bsudo\b/,
    description: 'uses sudo (privilege escalation)',
  },
  {
    id: 'nopasswd_sudo', severity: 'critical', category: 'privilege_escalation',
    pattern: /NOPASSWD/,
    description: 'NOPASSWD sudoers entry (passwordless privilege escalation)',
  },
  {
    id: 'suid_bit', severity: 'critical', category: 'privilege_escalation',
    pattern: /chmod\s+[u+]?s/,
    description: 'sets SUID/SGID bit on a file',
  },

  // ── Credential exposure ───────────────────────────────────────────────────
  {
    id: 'hardcoded_secret', severity: 'critical', category: 'credential_exposure',
    pattern: /(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}/i,
    description: 'possible hardcoded API key, token, or secret',
  },
  {
    id: 'embedded_private_key', severity: 'critical', category: 'credential_exposure',
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
    description: 'embedded private key',
  },
  {
    id: 'openai_key_leaked', severity: 'critical', category: 'credential_exposure',
    pattern: /sk-[A-Za-z0-9]{20,}/,
    description: 'possible OpenAI API key in skill content',
  },
  {
    id: 'anthropic_key_leaked', severity: 'critical', category: 'credential_exposure',
    pattern: /sk-ant-[A-Za-z0-9_-]{90,}/,
    description: 'possible Anthropic API key in skill content',
  },
  {
    id: 'aws_access_key_leaked', severity: 'critical', category: 'credential_exposure',
    pattern: /AKIA[0-9A-Z]{16}/,
    description: 'AWS access key ID in skill content',
  },
  {
    id: 'github_token_leaked', severity: 'critical', category: 'credential_exposure',
    pattern: /ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{80,}/,
    description: 'GitHub personal access token in skill content',
  },
];

// ── Invisible unicode characters used for injection ─────────────────────────

const INVISIBLE_CHARS: Record<string, string> = {
  '\u200b': 'zero-width space',
  '\u200c': 'zero-width non-joiner',
  '\u200d': 'zero-width joiner',
  '\u2060': 'word joiner',
  '\u2062': 'invisible times',
  '\u2063': 'invisible separator',
  '\u2064': 'invisible plus',
  '\ufeff': 'BOM/zero-width no-break space',
  '\u202a': 'LTR embedding',
  '\u202b': 'RTL embedding',
  '\u202c': 'pop directional',
  '\u202d': 'LTR override',
  '\u202e': 'RTL override',
  '\u2066': 'LTR isolate',
  '\u2067': 'RTL isolate',
  '\u2068': 'first strong isolate',
  '\u2069': 'pop directional isolate',
};

const INVISIBLE_CHARS_PATTERN = new RegExp(
  `[${Object.keys(INVISIBLE_CHARS).join('')}]`
);

// ── Scanning functions ──────────────────────────────────────────────────────

/**
 * Scan a single text file's content for threats.
 */
function scanContent(content: string, relPath: string): SkillFinding[] {
  const findings: SkillFinding[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>(); // patternId:lineNumber dedup

  // Regex pattern matching
  for (const tp of THREAT_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const key = `${tp.id}:${i}`;
      if (seen.has(key)) continue;
      if (tp.pattern.test(lines[i])) {
        seen.add(key);
        const match = lines[i].trim().slice(0, 120);
        findings.push({
          patternId: tp.id,
          severity: tp.severity,
          category: tp.category,
          file: relPath,
          line: i + 1,
          match,
          description: tp.description,
        });
      }
    }
  }

  // Invisible unicode detection
  for (let i = 0; i < lines.length; i++) {
    if (INVISIBLE_CHARS_PATTERN.test(lines[i])) {
      for (const [char, name] of Object.entries(INVISIBLE_CHARS)) {
        if (lines[i].includes(char)) {
          findings.push({
            patternId: 'invisible_unicode',
            severity: 'high',
            category: 'injection',
            file: relPath,
            line: i + 1,
            match: `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} (${name})`,
            description: `invisible unicode character "${name}" (possible text hiding/injection)`,
          });
          break; // one finding per line
        }
      }
    }
  }

  return findings;
}

/**
 * Structural checks on the skill directory file list.
 */
function checkStructure(
  files: Array<{ path: string; sizeBytes: number; isBinary: boolean; isSymlink: boolean; symlinkTarget?: string }>
): SkillFinding[] {
  const findings: SkillFinding[] = [];
  let totalSize = 0;

  for (const f of files) {
    totalSize += f.sizeBytes;

    // Single file size limit
    if (f.sizeBytes > MAX_SINGLE_FILE_KB * 1024) {
      findings.push({
        patternId: 'oversized_file',
        severity: 'medium',
        category: 'structural',
        file: f.path,
        line: 0,
        match: `${Math.round(f.sizeBytes / 1024)}KB`,
        description: `file is ${Math.round(f.sizeBytes / 1024)}KB (limit: ${MAX_SINGLE_FILE_KB}KB)`,
      });
    }

    // Symlink escape
    if (f.isSymlink && f.symlinkTarget) {
      findings.push({
        patternId: 'symlink_escape',
        severity: 'critical',
        category: 'traversal',
        file: f.path,
        line: 0,
        match: `-> ${f.symlinkTarget}`,
        description: 'symlink points outside the skill directory',
      });
    }

    // Suspicious binary extensions
    const ext = f.path.slice(f.path.lastIndexOf('.')).toLowerCase();
    if (SUSPICIOUS_BINARY_EXTENSIONS.has(ext)) {
      findings.push({
        patternId: 'binary_file',
        severity: 'critical',
        category: 'structural',
        file: f.path,
        line: 0,
        match: `binary: ${ext}`,
        description: `binary/executable file (${ext}) should not be in a skill`,
      });
    }
  }

  // File count limit
  if (files.length > MAX_FILE_COUNT) {
    findings.push({
      patternId: 'too_many_files',
      severity: 'medium',
      category: 'structural',
      file: '(directory)',
      line: 0,
      match: `${files.length} files`,
      description: `skill has ${files.length} files (limit: ${MAX_FILE_COUNT})`,
    });
  }

  // Total size limit
  if (totalSize > MAX_TOTAL_SIZE_KB * 1024) {
    findings.push({
      patternId: 'oversized_skill',
      severity: 'high',
      category: 'structural',
      file: '(directory)',
      line: 0,
      match: `${Math.round(totalSize / 1024)}KB total`,
      description: `skill is ${Math.round(totalSize / 1024)}KB total (limit: ${MAX_TOTAL_SIZE_KB}KB)`,
    });
  }

  return findings;
}

/**
 * Resolve source string to trust level.
 */
function resolveTrustLevel(source: string): TrustLevel {
  if (!source || source === 'bundled' || source === 'official' || TRUSTED_SOURCES.has(source)) {
    return 'builtin';
  }
  return 'community';
}

/**
 * Determine overall verdict from findings list.
 */
function determineVerdict(findings: SkillFinding[]): SkillVerdict {
  if (findings.length === 0) return 'safe';
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasHigh = findings.some((f) => f.severity === 'high');
  if (hasCritical) return 'dangerous';
  if (hasHigh) return 'caution';
  return 'caution'; // any finding = caution at minimum
}

// ── Public API ──────────────────────────────────────────────────────────────

export class SkillGuard {
  /**
   * Scan a skill from its in-memory file list (used during installation from URL or upload).
   * @param skillName  Human-readable name for the skill
   * @param source     Source string (e.g. 'url', 'bundled', 'directory', 'official/...')
   * @param files      Array of { path, content } representing all skill files
   */
  static scanFromFiles(
    skillName: string,
    source: string,
    files: Array<{ path: string; content: string }>
  ): SkillScanResult {
    const trustLevel = resolveTrustLevel(source);
    const allFindings: SkillFinding[] = [];

    // Structural checks using in-memory file info
    const fileInfos = files.map((f) => ({
      path: f.path,
      sizeBytes: Buffer.byteLength(f.content, 'utf-8'),
      isBinary: false,
      isSymlink: false,
    }));
    allFindings.push(...checkStructure(fileInfos));

    // Content scanning on each text file
    for (const file of files) {
      const ext = file.path.slice(file.path.lastIndexOf('.')).toLowerCase();
      if (!SCANNABLE_EXTENSIONS.has(ext) && !file.path.endsWith('SKILL.md')) continue;
      allFindings.push(...scanContent(file.content, file.path));
    }

    const verdict = determineVerdict(allFindings);
    const summary = buildSummary(skillName, source, trustLevel, verdict, allFindings);

    return {
      skillName,
      source,
      trustLevel,
      verdict,
      findings: allFindings,
      scannedAt: new Date().toISOString(),
      summary,
    };
  }

  /**
   * Scan a skill from the filesystem (used when loading from userSkillDir).
   * @param skillDir   Absolute path to the skill directory
   * @param skillName  Skill name
   * @param source     Source identifier
   */
  static scanFromDirectory(
    skillDir: string,
    skillName: string,
    source: string
  ): SkillScanResult {
    const trustLevel = resolveTrustLevel(source);
    const allFindings: SkillFinding[] = [];

    // Collect all files under skillDir
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const files: Array<{ path: string; sizeBytes: number; isBinary: boolean; isSymlink: boolean; symlinkTarget?: string }> = [];

    function walk(dir: string, prefix = '') {
      let entries: string[] = [];
      try { entries = readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        const full = `${dir}/${entry}`;
        const rel = prefix ? `${prefix}/${entry}` : entry;
        try {
          const st = statSync(full);
          if (st.isSymbolicLink()) {
            let target = '';
            try { target = realpathSync(full); } catch { /* broken */ }
            const outside = target && !target.startsWith(skillDir + '/') && target !== skillDir;
            files.push({ path: rel, sizeBytes: 0, isBinary: false, isSymlink: true, symlinkTarget: outside ? target : undefined });
          } else if (st.isDirectory()) {
            walk(full, rel);
          } else if (st.isFile()) {
            const ext = entry.slice(entry.lastIndexOf('.')).toLowerCase();
            const isBinary = SUSPICIOUS_BINARY_EXTENSIONS.has(ext);
            files.push({ path: rel, sizeBytes: st.size, isBinary, isSymlink: false });
          }
        } catch { /* skip unreadable */ }
      }
    }
    walk(skillDir);

    // Structural checks
    allFindings.push(...checkStructure(files));

    // Content scanning
    for (const f of files) {
      if (f.isSymlink || f.isBinary) continue;
      const ext = f.path.slice(f.path.lastIndexOf('.')).toLowerCase();
      if (!SCANNABLE_EXTENSIONS.has(ext) && !f.path.endsWith('SKILL.md')) continue;
      try {
        const content = readFileSync(`${skillDir}/${f.path}`, 'utf-8');
        allFindings.push(...scanContent(content, f.path));
      } catch { /* skip unreadable */ }
    }

    const verdict = determineVerdict(allFindings);
    const summary = buildSummary(skillName, source, trustLevel, verdict, allFindings);

    return {
      skillName,
      source,
      trustLevel,
      verdict,
      findings: allFindings,
      scannedAt: new Date().toISOString(),
      summary,
    };
  }

  /**
   * Determine whether a skill should be installed based on scan result.
   * @param result  Scan result from scanFromFiles() or scanFromDirectory()
   * @param force   If true, allows installation despite blocked verdict
   */
  static shouldAllowInstall(result: SkillScanResult, force = false): InstallDecision {
    const policy = INSTALL_POLICY[result.trustLevel];
    const vi = VERDICT_INDEX[result.verdict];
    const decision = policy[vi];

    if (decision === 'allow') {
      return { allowed: true, reason: `Allowed (${result.trustLevel} source, ${result.verdict} verdict)` };
    }

    if (force) {
      return {
        allowed: true,
        reason: `Force-installed despite ${result.verdict} verdict (${result.findings.length} finding(s))`,
      };
    }

    return {
      allowed: false,
      reason: `Blocked (${result.trustLevel} source + ${result.verdict} verdict, ${result.findings.length} finding(s)). Use overwrite=true to force.`,
    };
  }

  /**
   * Format a scan result as a human-readable report string.
   */
  static formatReport(result: SkillScanResult): string {
    const lines: string[] = [];
    lines.push(`Scan: ${result.skillName} (${result.source}/${result.trustLevel})  Verdict: ${result.verdict.toUpperCase()}`);

    if (result.findings.length > 0) {
      const severityOrder: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const sorted = [...result.findings].sort((a, b) =>
        (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
      );
      for (const f of sorted) {
        const sev = f.severity.toUpperCase().padEnd(8);
        const cat = f.category.padEnd(18);
        const loc = `${f.file}:${f.line}`.padEnd(30);
        lines.push(`  ${sev} ${cat} ${loc} "${f.match.slice(0, 60)}"`);
      }
      lines.push('');
    }

    const { allowed, reason } = SkillGuard.shouldAllowInstall(result);
    const status = allowed ? 'ALLOWED' : 'BLOCKED';
    lines.push(`Decision: ${status} — ${reason}`);
    return lines.join('\n');
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildSummary(
  name: string,
  source: string,
  trust: TrustLevel,
  verdict: SkillVerdict,
  findings: SkillFinding[]
): string {
  if (findings.length === 0) {
    return `${name}: clean scan, no threats detected`;
  }
  const categories = [...new Set(findings.map((f) => f.category))].sort().join(', ');
  return `${name}: ${verdict} — ${findings.length} finding(s) in ${categories}`;
}
