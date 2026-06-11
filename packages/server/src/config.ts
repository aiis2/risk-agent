import { z } from 'zod';

export const ServerConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.coerce.number().int().positive().default(8787),
  logLevel: z.string().default('info'),
  dataDir: z.string().optional(),
  /** 存储配置文件路径覆盖（默认 <dataDir>/config/storage.json）*/
  storageConfigPath: z.string().optional(),
  /** 存储部署 profile 显式声明，用于 /health 端点上报（server-deployment.md §9）*/
  storageProfile: z.string().optional(),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export function loadConfigFromEnv(): ServerConfig {
  return ServerConfigSchema.parse({
    host: process.env.RISK_AGENT_HOST,
    port: process.env.RISK_AGENT_PORT,
    logLevel: process.env.LOG_LEVEL,
    dataDir: process.env.RISK_AGENT_DATA_DIR,
    storageConfigPath: process.env.STORAGE_CONFIG_PATH,
    storageProfile: process.env.RISK_AGENT_STORAGE_PROFILE,
  });
}
