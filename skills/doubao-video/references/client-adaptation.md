# 客户端适配经验

2026-10-13验证的客户端为豆包1.57.0、Chromium147。CDP9229、桥接9230均绑定127.0.0.1。MCP采用stdio，不需要向外开放端口。

安装发布包不是完整源码。实际聊天页在CDP中为 `doubao://doubao-chat/...`，页面location为 `chrome://doubao-chat/...`。安装目录 `local_webcontents/extensions/ai-views` 的扩展源码模块编号不同，不能直接套到聊天页。

实际聊天页运行时数组 `@flow-web/desktop:stable`。已确认模块：609347.mH视频API实例、43016.SkillType.VideoGeneration=17、365392视频状态、528914参数函数。版本变化时重新定位，不猜新编号。

新版输入引擎选项来自当前组件的 `control.options`。仅用SW更新value会让UI仍显示旧模型/时长，必须通过SM同步实际选项中的value、id、label、selectedLabel以及actionBarItemId。之后同时检查状态与页面显示。

富文本输入通过CDP Input.insertText，按段落读取验证。innerText在相邻p之间可能插入双换行，不应据此误判漏字。

旧SkillPack的duration.options可能只有5和10秒，但model_capability支持4—15秒范围，新版实际控件也有完整选项。旧QueryVideoGenInfo在实际生成后可能仍返回10和false，因此不可作为可靠任务进度或实时余额依据。

源码观察与调用验证须区分；只有接口返回、真实参数显示、可播放视频及下载文件才证明相应阶段成功。使用REA修复客户端适配时，只分析必要的模块，不复制登录凭据或改动用户原配置。

2026-10-14冒烟补充：React控件显示会晚于参数设置，应只读等待UI稳定，不重新设值或提交。新对话URL先用local_编号，提交后变为正式数字编号；只允许核对本次提示词后的这一次绑定，不允许正式对话之间自动切换。

生成结果卡片会懒加载播放器。没有video元素时，从已成功卡片的video.videoModel中读取video_list，选择未加密H.264 MP4流，解码main_url；用流的vwidth/vheight，不能把卡片封面的384×216当成视频尺寸。禁止输出fallback_api、key_seed等不必要的媒体模型字段。收到完成文本后，仍须核对媒体资源并实际下载。

恢复任务时读取持久化请求/确认回执，不重置已确认标志。收尾脚本只调用状态和下载，不能重新确认或提交。客户端适配失误不应变成第二次生成。

同日修复：卡片同时有video.videoModel（普通版，lr=video_gen_watermark_dyn）和父组件removeAiWatermarkVideoModel/removeAiWatermarkVideoUrl（用户设置的去水印资源，lr=unwatermarked）。只解析前者会忽略客户端去水印设置。读取两者并优先选后者；不能让已加载的普通预览播放器盖过去水印卡片资源。下载时比对客户端提供的对应文件大小。所有链接必须原样来自客户端，禁止通过更改lr等参数伪造资源。

分享场景默认策略更新：两种资源都保留为候选，无水印优先，缺失或资源访问失败时使用普通版。通过fallback_used/fallback_reason/notice明确报告，不能称带水印文件为无水印。严格模式require_clean:true禁止降级。去水印元数据未准备好或解析失败不影响普通版候选；本地保存错误不触发降级。没有任何新生成、付费购买或修改源链接行为。

常用登录环境验证补充：2026-10-14由MCP启动原生目录后loginRequired=false，无需重新扫码。小窗口784×489会隐藏实际参数控件；使用Windows SetWindowPos扩大到1400×900后control.options恢复。更多菜单中的skill_bar_button_17需先展开skill_bar_button_more。prepare现自动处理这两处布局问题，不猜参数、不发送草稿。

1.2.0：从提交前的所有卡片任务ID形成基线，之后只有唯一新任务可自动绑定；旧回执无基线时要求明确绑定。页面恢复按正式对话地址扫描所有聊天页，保存新target_id但保留原摘要，不能通过导航覆盖草稿。实时控件查询来自当前React control.options，模型切换等待真实选项刷新。桥接health携带service和版本，MCP拒绝混用旧桥接。
