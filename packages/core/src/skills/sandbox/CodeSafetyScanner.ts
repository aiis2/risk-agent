/**
 * CodeSafetyScanner — 静态扫描技能/动态代码中的可疑模式。
 */
export interface SafetyReport {
  safe: boolean;
  warnings: Array<{ code: string; detail: string }>;
}

const DANGEROUS_PATTERNS: Array<{ code: string; pattern: RegExp; detail: string }> = [
  { code: 'eval', pattern: /\beval\s*\(/g, detail: '禁止直接使用 eval' },
  { code: 'function_ctor', pattern: /new\s+Function\s*\(/g, detail: '禁止 new Function()' },
  { code: 'child_process', pattern: /require\(['"]child_process['"]\)/g, detail: '禁止引入 child_process' },
  { code: 'fs_write', pattern: /\bfs\.(writeFileSync|unlinkSync|rmSync)\b/g, detail: '存在写文件或删除文件调用，应走受控对象存储' },
  { code: 'process_env', pattern: /process\.env\.[A-Z_]*KEY/g, detail: '疑似读取 API Key，需要走安全注入' }
];

export class CodeSafetyScanner {
  scan(code: string): SafetyReport {
    const warnings: SafetyReport['warnings'] = [];
    for (const rule of DANGEROUS_PATTERNS) {
      if (rule.pattern.test(code)) {
        warnings.push({ code: rule.code, detail: rule.detail });
      }
    }
    return { safe: warnings.length === 0, warnings };
  }
}
