# Duo Watch：iPhone Duo 门店取货库存提醒（自用）

两部分：

- `extension/`：Chrome 扩展。在你自己的 apple.com 页面里，用你自己的浏览器会话，大约每 10 秒（±2 秒随机）查一次附近门店能不能取货。
- `helper/duo_alarm.py`：Mac 本地报警助手。有货时把音量开到最大，循环播放警报和中文语音并弹窗，直到你点"我知道了"。它运行期间 Mac 不会自动睡眠，扩展一出问题它会用语音提醒你。

## 1. 启动报警助手（先做）

```bash
python3 helper/duo_alarm.py --test   # 先试一次，确认够响（点"我知道了"停止）
python3 helper/duo_alarm.py          # 正式运行，保持这个终端窗口开着
```

想让手机也收到推送：在手机上装 ntfy App，订阅一个只有你知道的随机主题名，然后：

```bash
NTFY_TOPIC=duo-你自己的随机字符串 python3 helper/duo_alarm.py
```

## 2. 安装扩展

1. Chrome 打开 `chrome://extensions`，打开右上角"开发者模式"
2. 点"加载已解压的扩展程序"，选择 `extension` 文件夹
3. 打开你所在地区的 iPhone Duo 购买页：
   - 美国：https://www.apple.com/shop/buy-iphone/iphone-duo
   - 加拿大：https://www.apple.com/ca/shop/buy-iphone/iphone-duo
4. 页面右下角会出现 Duo Watch 面板：填邮编，型号会自动识别（256GB Star White），然后点"开始监控"
5. 把这个标签页拖成单独一个窗口，放着不用管（不要最小化）。Chrome 的"节能模式"建议关掉

扩展图标上的小字表示状态：`OK` 正常，`ERR` 出错正在退避重试，`!!!` 有货。

## 有货时会发生什么

- Mac：音量调到 100 并取消静音，循环播放警报和语音"iPhone Duo 有货了"，弹窗，自动打开购买页
- Chrome：系统通知（不点不消失），窗口跳到最前面，页面标题和面板红白闪烁
- 手机：如果设置了 ntfy，会收到最高优先级推送
- 点弹窗里的"我知道了"或面板上的"停止报警"即可停止。同一家店不会重复报警

## 常见问题

**token/cookie 过期怎么办？** 这个接口不需要登录。Apple 用的是反爬 cookie，扩展每 30 分钟自动刷新一次页面来更新它们。连续 3 次失败也会自动刷新。出错时按 20 秒、40 秒、80 秒……最多 5 分钟的间隔退避重试，恢复后回到 10 秒。

**合上盖子怎么办？** Mac 一睡眠，什么都会停。助手已经阻止了"闲置睡眠"（屏幕可以黑），但合盖仍然会睡。可以选：

- 不合盖，屏幕亮度调到最低（最简单）
- 接电源 + 外接显示器，合盖进入"合盖模式"
- 自己在终端运行 `sudo pmset -a disablesleep 1`，合盖也不睡；用完一定要改回来：`sudo pmset -a disablesleep 0`。注意不要合盖放进包里，会过热

**看到 HTTP 541？** 那是 Apple 的反爬限制。扩展会自动退避。如果 5 分钟都没成功，助手会语音提醒你。
