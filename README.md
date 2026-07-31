# 暗标 AnBiao

一个匿名的「暮色拾光」地图：人人可上传 **图像 + 城市/地址 + 描述**，散落在各座城市的暮色被收录进一张共同的地图。**纯前端**，部署在 **GitHub Pages**，数据作为文件存在 **GitHub 仓库的 `data` 分支** 里。

- 每个设备首次访问自动生成固定匿名身份（localStorage UUID）→ 设备 id 哈希出虚拟名 + 头像
- 双标签页：**社区**（按城市筛选的卡片流）与 **我的**（虚拟名、头像、隐藏设备码、我的记录）
- 右下角柔光脉冲 ＋ 唤起上传弹层：高德地图点选/定位 → 逆地理自动填城市与地址
- 每个设备每天可上传 2 次（软限制，见下方说明）
- 上传后约 1~2 分钟通过 GitHub Actions 构建并公开
- 社区举报达阈值（默认 3 次）自动隐藏，无需人工预审
- 高德 AMap JS API 2.0 免费地图与逆地理

> 技术栈：Vue 3 + Vite + Tailwind CSS v4 + 高德 AMap。无后端。

---

## ⚠️ 你必须先读：安全模型与固有代价

纯前端 + 所有人可上传 + GitHub 托管，意味着**浏览器里必须带着一个能写你仓库的凭证**。这个 token 出现在前端打包后的 JS 里，任何人用开发者工具都能提取。这是该架构无法消除的固有代价。

缓解措施：使用**细粒度 PAT**，权限压到最小：

- Repository access：仅本仓库
- Permissions → Contents：**Read and write**
- 若 GitHub 提供 **branch** 级限定，限定到 `data` 分支（写不到 `main`/源码/workflow）
- 若你的仓库类型不支持分支级限定 → 改用**独立的数据仓库**，让 token 物理上够不到源码

即便泄露，攻击者也只能往「本来就公开、本来就靠举报兜底」的数据分支灌内容，动不了你的源码和部署流程。

---

## 首次部署步骤

### 1. 新建仓库并推送代码
```bash
git init
git add -A
git commit -m "init: geo collector"
git branch -M main
git remote add origin https://github.com/<你>/geo-collector.git
git push -u origin main
```

### 2. 创建 `data` 分支
```bash
git checkout --orphan data
git rm -rf .
mkdir data images
echo '{"readme":"data branch"}' > data/.keep
git add -A && git commit -m "init data branch"
git push origin data
git checkout main
```

### 3. 创建细粒度 PAT
GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens：
- Repository access：Only select repositories → 选 `geo-collector`
- Repository permissions → Contents：Read and write
- （如可见）限制到 `data` 分支
- 生成并复制 token

### 4. 配置仓库 Secret
仓库 Settings → Secrets and variables → Actions → New repository secret：
- Name：`VITE_DATA_TOKEN`
- Value：上一步的 token

### 5. 开启 Pages
仓库 Settings → Pages → Source：**GitHub Actions**

### 6. 推送触发部署
```bash
git push   # 任意 push 到 main 都会触发 deploy.yml
```
约 1~2 分钟后访问 Pages URL 即可。

### 7. 配置高德地图 Key（必填才能用地图点选与逆地理）
1. 登录 [高德开放平台控制台](https://console.amap.com)，创建「Web 端(JS API)」应用，获取 **Key** 与 **安全密钥（securityJsCode）**。
2. 在应用设置里配置 **Referer 白名单**为你的 Pages 域名（如 `https://<你>.github.io/anbiao/`），缩小密钥被盗用的范围。
3. 仓库 Settings → Secrets and variables → Actions 新建两个 secret：
   - `VITE_AMAP_KEY`：上一步的 Key
   - `VITE_AMAP_SECRET`：上一步的安全密钥

> 2021-12-02 之后新建的高德 Key **必须**设置 `window._AMapSecurityConfig.securityJsCode`，否则所有调用报 `INVALID_USER_SCODE`。本应用在加载高德脚本前同步注入该配置（见 `src/lib/amap.js`）。

---

## 本地开发
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产物在 dist/
```
本地无 `VITE_DATA_TOKEN`，上传会失败（前端会提示）；地图、展示、举报、筛选 UI 可正常预览。未配置 `VITE_AMAP_KEY`/`VITE_AMAP_SECRET` 时，上传弹层进入**本地回退模式**：用浏览器定位（WGS-84 坐标，与正式环境的 GCJ-02 略有偏差）+ 内置城市下拉 + 手动地址。如需本地预览高德地图，建 `.env.local`：
```
VITE_AMAP_KEY=你的key
VITE_AMAP_SECRET=你的安全密钥
```

## 环境变量（构建期注入）
| 变量 | 说明 |
|---|---|
| `VITE_DATA_TOKEN` | 细粒度 PAT，写入数据分支（必填才能上传） |
| `VITE_GH_OWNER` | 仓库所有者（workflow 自动注入） |
| `VITE_GH_REPO` | 仓库名（workflow 自动注入） |
| `VITE_REPO_NAME` | 用于计算 Pages base 路径（workflow 自动注入） |
| `VITE_DATA_BRANCH` | 数据分支名，默认 `data` |
| `VITE_BASE_URL` | 自定义域名时设为 `/` |
| `VITE_AMAP_KEY` | 高德 Web JS API Key（必填才能用地图与逆地理） |
| `VITE_AMAP_SECRET` | 高德安全密钥 securityJsCode（必填） |

## 数据结构
每条记录是 `data` 分支上一个独立 JSON 文件 `data/<uuid>.json`，图片在 `images/<uuid>.jpg`（同一提交的图像与记录共用该 UUID，保证命名一致）：
```json
{
  "id": "uuid", "deviceId": "设备ID", "createdAt": "ISO时间",
  "lat": 31.23, "lng": 121.47, "city": "上海市", "address": "地址", "description": "描述",
  "image": "images/<uuid>.jpg", "status": "published", "reports": []
}
```
构建时 `scripts/aggregate.js` 把所有 JSON 聚合成单个 `dist/data.json`（排除 hidden），图片拷进 `dist/images/`，供站点一次加载。坐标系为 GCJ-02（高德）。

## 社区城市筛选
社区页顶部展示数据中出现的城市芯片（多选）。**默认全部展示**（含无 `city` 字段的旧记录）；选中具体城市后只显示这些城市的内容，无城市旧记录此时隐藏。选择持久化在 localStorage。

## 诚实风险清单
1. **token 在前端产物里可被提取** —— 分支限定 + 举报兜底缓解，无法消除。
2. **高德 Key/安全密钥同样在前端产物里可被提取** —— 与上一条同类风险。缓解：控制台设 Referer 白名单限定 Pages 源；安全密钥不可写仓库数据，危害低于写 token。彻底消除需自建代理服务（超出纯前端范围）。
3. **2次/天（设备维度）可被绕过** —— 软限制；举报是硬兜底。
4. **仓库随图片增长** —— 客户端压缩延缓；量大后需定期清历史。
5. **上传后约 1~2 分钟延迟**才公开展示（Actions 构建部署）。
6. **同设备清缓存即换身份** —— 纯前端无法避免。
7. **不取用户 IP** —— 故意决策：换取零 NAT 误伤、零 IP 隐私暴露，代价是只有设备维度软限制。
8. **本地回退模式坐标为 WGS-84** —— 仅在无高德 Key 时触发，与正式环境 GCJ-02 约 100–500m 偏差；正式部署必配 Key，回退仅用于本地预览。

## 可选增强（未来）
- 把写操作改走一个 Cloudflare Worker 持密钥 → token 彻底离开浏览器，2次/天变真强制（需约 30 行后端）。
- 同理可用 Worker 代理高德请求，让 AMap Key/密钥离开前端。
