/**
 * npm 发行版的组成契约 —— **单一事实来源**。
 *
 * 为什么要有这个文件：npm 的发布期自动审查对本包的判定是"包在安装后会自动下载渗透工具
 * （`scripts/redteam-setup.sh` 从 GitHub 拉 11 个二进制并 chmod +x）"，加上 9 份攻击操作手册型
 * 技能（隧道/凭据/WebShell/反弹 Shell/横向移动）。这两类内容的**行为特征与真实供应链攻击、
 * 恶意工具包无法区分**，因此 0.11.x 全部卡在自动审查（`Blocked: ... failed automated review`）。
 *
 * 发行策略（0.12.0 起）：
 *   · npm 包 = **编排与事实库**：角色编排、预检、SQLite 库、得分规则、报告、Web 控制台、
 *     侦察/检测向技能。**不含**任何"自动下载/安装安全工具"的代码，也不含攻击操作手册。
 *   · 完整工具箱（下载器 + 那 9 份技能）= 走 GitHub Release 附件按需获取，由用户显式执行。
 *
 * 这份声明被三处消费：
 *   1. `tools/build.mjs` —— 打包时按它排除文件；
 *   2. `packages/redteam-tools` 的预检 —— 按它告诉用户"缺的能力去哪拿"，而不是自己去装；
 *   3. `test/bundle.test.mjs` —— 断言 npm 产物里**不得出现**这些文件（防止改回去）。
 *
 * 改这里就等于改发行形态，请连带更新 README / DISCLOSURE / Release 说明。
 */

/** npm 包里**不含**的技能（渗透攻击/探测操作手册型）。仍留在仓库，随 Release 附件分发。 */
export const OMITTED_SKILLS = [
  'active-scan.md',
  'ad-attack.md',
  'ai-agent-attack.md',
  'api-data-exfil.md',
  'asset-correlation.md',
  'c2-infra.md',
  'chisel-tunnel.md',
  'cloud-k8s.md',
  'cn-proxy-pool.md',
  'credential-attack.md',
  'deepseek-web-intel.md',
  'dir-bruteforce.md',
  'fofa-recon.md',
  'frp-tunnel.md',
  'fscan-intranet.md',
  'gogo-intranet.md',
  'kimi-webbridge.md',
  'lateral-movement.md',
  'mobile-code-recon.md',
  'netspy-recon.md',
  'network-device.md',
  'nuclei-scan.md',
  'oob-verify.md',
  'passive-recon.md',
  'recon-pipeline.md',
  'redteam-setup.md',
  'score-coverage.md',
  'shell-handler.md',
  'specialist-paths.md',
  'suo5-tunnel.md',
  'unauth-exploit.md',
  'vps-reverse-shell.md',
  'web-fingerprint.md',
  'webshell-toolkit.md',
]

/** npm 包里**不含**的脚本（自动下载并安装渗透二进制 = 自动审查眼中的恶意行为特征）。 */
export const OMITTED_SCRIPTS = [
  'redteam-setup.sh',
]

/** 完整工具箱附件的文件名（Release 附件），给人看的说明用。 */
export const EXTRA_TOOLKIT_NAME = 'dsh-lmtagent-<版本>-security-toolkit.tar.gz'

/** 附件里给用户看的说明（`lmt_preflight` 与文档共用同一段口径）。 */
export const EXTRA_TOOLKIT_HINT =
  '可选安全审计扩展工具箱（安装脚本 + 渗透探测技能）不随 npm 默认工程包分发：'
  + '如需使用，请从 GitHub Release 附件 ' + EXTRA_TOOLKIT_NAME + ' 按需获取并手动解压。'
  + '本包默认仅随包提供 12 份软件工程与 CI/工作流核心技能。'

/** 技能是否随 npm 包分发。 */
export function isSkillShipped (fileName) {
  return !OMITTED_SKILLS.includes(fileName)
}

/** 脚本是否随 npm 包分发。 */
export function isScriptShipped (fileName) {
  return !OMITTED_SCRIPTS.includes(fileName)
}
