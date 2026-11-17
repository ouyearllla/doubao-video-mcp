---
name: doubao-video
description: 使用本机豆包桌面客户端生成和下载视频，或检查已有生成任务；通过 doubao MCP 复用登录窗口、定制模型比例时长、恢复原任务。适用于明确要求用豆包制作视频的任务。
---

# 豆包视频

使用doubao MCP，不依赖截图坐标。默认Seedance 2.0 Fast、16:9、15秒；用户可定制model、ratio、duration。模型编号：Fast=seedance_v2.0，Mini=seedance_v2.0_mini，2.0=seedance_v2.0_std，2.5=seedance_v2.5，2.5 Flash=seedance_v2.5_flash。实际可用性以当前客户端选项与账号权限为准，不静默替换。

## 连接与参数

- 用doubao_connect复用常用客户端的登录。首次切换时，常用豆包若已运行且未启用调试，需用户在托盘完整退出一次再连接；不强行关闭窗口、不复制Cookie。客户端确实提示登录时再请用户登录。
- 连接、路径或版本问题用doubao_doctor排查，它不启动客户端。新版代码需要重新打开MCP客户端加载；安装和其他客户端配置见分享包README。
- 先inspect确认草稿和当前对话，默认新生成用new_chat，不能覆盖已有草稿。用户要求在原对话继续生成时保留上下文，但已有对话的卡片可能虚拟化隐藏，生成后需明确绑定真实task_id，不能猜测。用video_options查看当前模型的真实选项；该工具仅进入视频模式，不生成。video_config只读，不把旧Quota当实时额度或完成证据。
- video_prepare传用户要求的model/ratio/duration。它先切模型并等待选项刷新，再设置比例和时长；成功必须ui_verified=true。不支持的选项要说明限制。

## 生成与结果

1. video_draft写入完整提示词，保留台词、镜头限制及禁止事项。
2. 用户授权生成后创建唯一request_id，video_submit传原prompt、与prepare完全一致的参数和commit:true。默认参数省略和显式传默认值等价。请求编号必须保存；失败或断连时检查原请求，不换编号自动重发。
3. 豆包要求确认时，video_confirm用原request_id和commit:true，自动沿用已保存参数。确认参数不同或出现升级购买提示时停止，不替用户购买。用户已授权的同一生成无需重复询问。
4. video_status(request_id)只读取已绑定到本次请求的结果。绑定状态pending表示任务尚未出现；required表示旧回执缺少绑定信息；ambiguous表示多个新任务不能唯一归属。后两种状态不能拿旧视频交付，需用户明确选定原对话中的task_id后用video_bind_task绑定。禁止自动猜测。轮询约30—60秒，不再次提交。
5. video_download(request_id)保存到当前聊天outputs或用户指定目录，传绝对output_dir和唯一filename。默认优先无水印，缺少或资源不可下载则降级普通版并如实告知；明确要求必须无水印时才传require_clean:true。核对watermark、fallback_used、notice和实际文件信息，不能把unknown称作无水印。

只使用客户端真实提供的媒体链接，不修改链接参数、裁切水印、重新生成或购买订阅来完成下载。返回成功文本不是视频完成证据；成功卡片里的任务、实际媒体和文件校验才是证据。未验收画面动作或英语台词时明确区分流程通过与创作质量通过。

## 恢复任务

用doubao_list_requests找原编号；doubao_resume_request重新定位或打开保存的原对话，不重发生成。重启后的页面ID可变化，正式对话地址不能自动换成另一个对话。恢复导航遇到草稿或正在回复时拒绝，先保留草稿或另开窗口。

replayed:true是旧回执，不是新生成；uncertain表示结果不确定，不能自动重试付费动作。list_requests不显示原提示词或下载链接。客户端控件结构确实变化时再读[适配经验](references/client-adaptation.md)，不在每次生成前重新逆向。每次生成或测试仅运行用户授权的数量。
