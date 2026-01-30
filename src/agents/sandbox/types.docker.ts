export type SandboxDockerConfig = {
  image: string;
  containerPrefix: string;
  workdir: string;
  readOnlyRoot: boolean;
  tmpfs: string[];
  network: string;
  user?: string;
  capDrop: string[];
  env?: Record<string, string>;
  setupCommand?: string;
  pidsLimit?: number;
  /** Memory limit (e.g. "2g"). Default: "2g" for security hardening. */
  memory: string | number;
  memorySwap?: string | number;
  /** CPU limit (e.g. 1). Default: 1 for security hardening. */
  cpus: number;
  /** Per-command execution timeout in milliseconds. Default: 300000 (5 minutes). */
  timeout: number;
  ulimits?: Record<string, string | number | { soft?: number; hard?: number }>;
  seccompProfile?: string;
  apparmorProfile?: string;
  dns?: string[];
  extraHosts?: string[];
  binds?: string[];
};
