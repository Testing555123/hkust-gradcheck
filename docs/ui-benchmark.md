# UI 基准对标报告：高星前端项目能给本站什么

> 对标范围：GitHub 高星开源项目（shadcn/ui、cal.com、dub.co、twenty）与顶级商业产品（Linear、Vercel Dashboard）。
> 对照对象：本站前端（React 18 + shadcn 风格组件 + Tailwind，三页 SPA：方案总览 / 课程选择 / 要求明细）。
> 调研日期：2026-09-06。

## 1. 标杆与可迁移模式

| 标杆 | 关键模式 | 为什么适合我们 |
|---|---|---|
| shadcn/ui 官方 blocks（dashboard-01 等） | 统计卡 = 图标 + 语义色底 + 数值 + 描述行；图表卡独立成块；页面 = 卡片网格 | 技术栈完全同款，抄的是结构而不是风格，迁移成本最低 |
| Linear | 「当下最该关注什么」的单焦点信息架构；克制微动效（150-200ms，只动 transform/opacity）；行级完成反馈（划线、渐变底色） | 我们的核心场景就是"看进度、补缺口"，缺一个视觉锚点 |
| Vercel Dashboard | 径向进度环 + 大数字的 hero 焦点；卡片信息密度高但不拥挤 | 毕业进度天然是一个 0-100% 的径向量 |
| cal.com / dub | 列表筛选 chips（带计数）、toast 操作反馈、空态带 CTA、⌘K 命令面板 | 课程列表页正缺筛选；勾选/清空等操作缺反馈 |

## 2. 对照差距（按感知价值排序）

1. **总览页没有焦点**：4 个裸数字 + 两根横条 + N 张同质组卡，用户无法一眼回答"我毕业还差多少"。
2. **课程页没有筛选**：只能搜索不能按状态过滤；勾选后想看"我已修了哪些"要靠肉眼扫。
3. **微动效缺失**：唯一动画是 fade-in-up；进度条瞬间到满值，勾选完成没有划线/变色过渡。
4. 操作反馈靠"看页面变化"，无 toast；空态无 CTA（搜索无结果只有一行灰字）。
5. 导航 Tab 无图标无计数，三个标签辨识度低。

## 3. 本轮落地（2026-09）

| 项 | 内容 | 借鉴来源 |
|---|---|---|
| 总览仪表盘重做 | hero 双读数焦点（缺口学分 + 毕业进度%）+ 全宽横向进度条；Stat 卡升级为图标 + 语义色。曾试过 recharts 径向环，因占位过高改为横条并卸载依赖 | Vercel / shadcn blocks |
| 课程页 UX 包 | 状态筛选 chips（全部/已修/计划/未选，实时计数）+ 空态「清除筛选」CTA + toast | cal.com / dub |
| 微交互包 | 进度条 grow-in、已修划线过渡、tabular-nums 数字；全部纯 CSS，150-200ms | Linear |
| 导航强化 | Tab 加图标 + 计数徽标 | shadcn blocks |

依赖增量：`recharts`（径向图）、`sonner`（toast）。其余全部用现有组件与语义 token，未新增颜色变量。

## 4. 改进 backlog（本次未做，按性价比排序）

| 优先级 | 项 | 说明 | 前置条件 |
|---|---|---|---|
| P1 | ⌘K 命令面板 | 搜课/切专业/切 Tab 一处直达（cmdk，shadcn 官方组件） | 页面与数据量再涨一些后收益更明显 |
| P1 | 学期时间线 | 按学期聚合已修/计划课程，横向 timeline 呈现 | term 录入入口完善 |
| P2 | 主修 + 辅修双进度 | 总览同时渲染多棵要求树汇总 | 后端接入 minor/extended 数据（当前后端无此概念） |
| P2 | Sidebar 布局 | shadcn sidebar block 式左侧导航 | 页面数 > 5 再考虑，当前三页会浪费内容区 |
| P3 | 学分缺口智能提示 | 「下学期修 X 门即可覆盖」类建议（基于 offered_semesters 字段） | courses.db 开课学期数据补全 |
| P3 | ~~图表懒加载~~ | 已关闭：径向环改为横条后 recharts 已卸载；未来重新引入图表时再评估 React.lazy | 不适用 |

## 5. 方法论沉淀

- **抄结构不抄皮**：shadcn 生态的借鉴点几乎都是"卡片结构 + 语义 token"，直接映射到我们的 `Card` 体系，不需要引 UI 库。
- **动效克制**：只动 transform/opacity，150-200ms；动效服务状态变化（勾选、达标），不做装饰性动画。
- **反馈分层**：局部状态变化用行内动效（划线、进度条 grow），全局/破坏性操作才用 toast。
- **单焦点优先于信息平铺**：仪表盘第一屏回答一个问题，其余数据降级为卡片网格。

## 6. 第二轮迭代（2026-09-08）：架构与移动优先

> 背景：功能性已完备，本轮只做体验层。新增参考：[shadcn-ui/ui](https://github.com/shadcn-ui/ui) 123k（blocks 结构）、[tremorlabs/tremor-npm](https://github.com/tremorlabs/tremor-npm) 16.5k（BarList/CategoryBar 视觉）、[coursetable/coursetable](https://github.com/coursetable/coursetable) 72（Yale 选课站，领域同构：搜索 + 多维筛选 + 列表密度 + 详情抽屉）。

### 落地

| 项 | 内容 | 借鉴来源 |
|---|---|---|
| 侧栏架构 | 三 Tab → Sidebar（桌面常驻 240px / 小屏收进抽屉），导航项带计数徽标与 `aria-current`，底部预留「规划中」分组 | shadcn sidebar block |
| 总览页单焦点 | `ProgressHero`：巨型缺口数字 + 双口径分段进度条（已修实色 / 计划半透明，纯 `scaleX` 动画） | Vercel / Linear |
| 组完成度占比条 | `GroupBarList`（纯 CSS 复刻 Tremor BarList）：组名 + 右对齐学分 + 双口径细条 + 缺口课程代码，替代原等高 `ProgressCard` 网格 | Tremor |
| 移动端重排 | 课程行改为卡片流（课号课名置顶、已修/计划大按钮 ≥44px）、要求树小屏默认折叠 + 组进度条、底栏导航 + 安全区适配 | CourseTable / iOS HIG |
| 底部抽屉 | `vaul` 实现：小屏课程详情与导航菜单从底部升起，替代被挤压的居中弹窗 | CourseTable 抽屉 |
| 状态统一 | `EmptyState` 扩尺寸与三态变体、新增 `ErrorState`（含重试）、`PageSkeleton` 三种密度与最终布局同构 | dub / cal.com |
| 可访问性 | Skip Link、全局 `focus-visible` 焦点环、`role="progressbar"` + `aria-valuetext`、`prefers-reduced-motion` 降级 | WAI-ARIA |

依赖增量：仅 `vaul`（约 30KB，主包 489KB → 531KB）。`cmdk` 本轮未装（⌘K 不在范围内），图表继续纯 CSS，未引 recharts / Tremor。

### 验证

- 单测 83 例全过；`tsc -b` 与 `eslint` 0 error；`npm run build` 通过
- playwright 截图（桌面/移动 × 浅色/深色，共 8 张）见 `docs/ui/2026-09-redesign/`；控制台 0 报错

### 新一轮 backlog

| 优先级 | 项 | 说明 | 前置条件 |
|---|---|---|---|
| P1 | ⌘K 命令面板 | 搜课 / 切方案 / 切视图一处直达（`cmdk`，已在侧栏预留分组位） | 页面与数据量再涨一些后收益更明显 |
| P1 | 侧栏「规划中」落地 | 主修+辅修双进度、学期时间线（分组位与折叠态已就绪） | 后端接入辅修/学期数据 |
| P2 | 课程列表虚拟滚动 | 当前 ≤2000 条无压力；若放开全量课程库再评估 | 数据量增长 |
| P2 | 图表语义化 | 若需趋势/分布图，优先纯 SVG，避免再引图表库 | 有明确图表需求时 |
| P3 | 骨架屏自动化 | 把三种 `PageSkeleton` 与真实布局做像素级对齐检查 | 视觉回归测试基建 |
