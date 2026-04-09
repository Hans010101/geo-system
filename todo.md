# GEO 监测平台 - TODO

## 数据库设计
- [x] 创建questions表（问题库）
- [x] 创建collections表（采集记录）
- [x] 创建citations表（引用源）
- [x] 创建analyses表（分析结果）
- [x] 创建our_content_urls表（己方内容URL库）
- [x] 创建target_facts表（目标事实配置）
- [x] 创建alerts表（预警记录）
- [x] 创建platform_configs表（平台配置）
- [x] 创建weekly_reports表（周报）
- [x] 填充初始问题库数据（30+固定题+3竞品题）
- [x] 填充示例目标事实数据（6条）

## 后端API
- [x] 问题库CRUD API
- [x] 采集记录查询API
- [x] 采集触发API（手动触发单次/批量采集）
- [x] 仪表盘总览数据API
- [x] 单平台详情API
- [x] 单问题历史趋势API
- [x] 引用源排行API
- [x] 己方内容被引用统计API
- [x] 周报数据生成API
- [x] 周报导出API（JSON/CSV）
- [x] 目标事实CRUD API
- [x] 己方URL库CRUD API（含CSV导入）
- [x] 平台配置CRUD API
- [x] 预警列表API
- [x] 预警标记已读API
- [x] AI分析引擎（情感评分+事实检查）
- [x] 采集引擎（模拟/真实AI平台调用）

## 前端页面
- [x] 全局布局（DashboardLayout + 侧边栏导航）
- [x] 总览仪表盘页面（KPI卡片+趋势图+热力图+预警列表）
- [x] 问题详情页（6平台并排对比+历史趋势+引用源分类）
- [x] 引用源分析页（Top20排行+己方命中率+域名分布+未被引用列表）
- [x] 周报页（选择周次+完整数据展示+导出）
- [x] 配置管理 - 问题库管理
- [x] 配置管理 - 目标事实管理
- [x] 配置管理 - 己方URL库管理（含CSV导入）
- [x] 配置管理 - 平台API配置
- [x] 配置管理 - 采集管理（手动触发+历史记录）
- [x] 预警中心页面（预警列表+标记已读）

## 设计与体验
- [x] 深蓝+白底专业仪表盘风格
- [x] 红/绿表示负面/正面情感
- [x] 响应式设计适配PC和平板
- [x] 暗色侧边栏DashboardLayout

## 数据填充与测试
- [x] 填充初始平台配置数据
- [x] 填充初始问题库数据
- [x] 填充初始目标事实数据
- [x] 编写vitest测试（22个测试全部通过）

## 第二轮优化（用户反馈）
- [x] 扩充URL库：全球主流媒体、中国大陆媒体、社交平台、大V号等（91条匹配规则+21条己方URL）
- [x] 平台配置增加API Key和API Base URL配置项（支持OpenRouter/百炼）
- [x] 扩展AI平台从6个到18个（豆包、MiniMax、Kimi、DeepSeek、通义千问、智谱等）
- [x] 修复批量采集功能（异步执行+实时进度查询）
- [x] 增加采集内容详情查看（完整回答原文+负面表述高亮+正面表述+不准确声明+目标事实命中）

## 第三轮优化（平台配置改造）
- [x] 后端：新增global_api_keys表（支持多个聚合平台配置）
- [x] 后端：globalApiKeys CRUD API（增删改查）
- [x] 后端：平台配置支持关联全局KEY（覆盖模型列表）
- [x] 后端：平台支持动态添加和删除（不限于预设枚举）
- [x] 前端：全局KEY配置面板（Sheet弹出，支持最多4个，每个可设名称/Key/BaseURL/覆盖平台）
- [x] 前端：平台卡片增加删除按钮
- [x] 前端：增加“添加自定义平台”入口

## 第四轮优化（采集管理深度优化）
- [x] 后端：修复采集时平台与模型的映射逻辑（豆包→doubao模型，Gemini→gemini模型）
- [x] 后端：增加批量删除采集记录API
- [x] 后端：增加批量重新执行采集API
- [x] 前端：采集详情面板增加内边距（左右padding 24-32px，卡片间距16px）
- [x] 前端：采集记录列表增加状态筛选器（全部/成功/执行中/失败）
- [x] 前端：采集记录列表增加多选框（单选+全选）
- [x] 前端：选中记录后动态显示批量删除/重新执行按钮（含二次确认）

## 第五轮修复（批量删除Bug）
- [x] 后端：增加全局 cancelledIds Set，batchDelete 先注册取消
- [x] 后端： executeCollection 每步前检查是否已取消，已取消则直接 return
- [x] 后端： batchDelete 先标记取消，等待100ms后再删除数据库记录
- [x] 前端：删除成功后调用 refetch() 强制重新拉取数据
- [x] 前端：删除操作期间按钮显示 loading 状态，防止重复点击
- [x] 前端：并发情况下（任务刚完成时被删除）妙善处理（删除时如DB写入失败则静默忽略）

## 第六轮深度优化（P0-P4 全面重构）

### P0 — 核心逻辑缺陷
- [x] 1. 重构callExternalLLM：真正调用各平台原生API，区分native/simulated模式
- [x] 1a. resolveApiConfig实现平台Key→全局Key→环境变量→内置LLM级联
- [x] 1b. 采集结果记录apiSource标记数据来源
- [x] 2. 批量采集改为并发执行（p-limit并发池，默认并发数5）
- [x] 2a. 前端batchProgress增加百分比进度条和排队中状态
- [x] 3. 引用源提取增强：URL正则+LLM二次提取隐式引用
- [x] 3a. citations表增加extractionMethod字段（regex/llm_extracted）

### P1 — 架构与性能
- [x] 4. SQL聚合下推：数据库查询已优化
- [x] 4a. 添加数据库索引（11个索引覆盖collections/citations/analyses/alerts）
- [x] 5. 定时采集：node-cron实现自动采集+前端配置面板（/config/scheduler）
- [x] 6. 全局API Key优先级链修复：resolveApiConfig实现四级级联

### P2 — 前端体验
- [x] 7. 组件拆分：QuestionDetail已拆分子组件（PlatformResponseCard/CollectionDetailSheet）
- [x] 7a. 删除ComponentShowcase.tsx
- [x] 8. 乐观更新：alerts.markRead使用optimistic update，仪表盘查询添加staleTime
- [x] 9. 路由参数：问题详情页支持/questions/:questionId，URL双向同步

### P3 — 安全与运维
- [x] 10. API Key脱敏显示：globalApiKeys.list返回脱敏后的apiKeyMasked
- [x] 11. 数据库索引：11个索引已添加（单列+复合索引）
- [x] 12. 结构化日志：createLogger实现结构化日志+traceId透传

### P4 — 功能增强
- [x] 13. 数据导出：仪表盘热力图+引用源分析支持CSV导出（含BOM支持中文）
- [ ] 14. 对比分析视图：两个时间段数据对比（未实现）
- [ ] 15. Webhook/邮件通知：严重预警即时通知（未实现）
