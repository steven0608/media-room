// English / 中文. Every word the user sees comes from here, so the whole room —
// 2D pages, the 3D console, the library, the screen and the karaoke board — switches
// language together. To add a language, add a column to STRINGS and to LANGS.
import { store } from './api.js';

export const LANGS = { en: 'English', zh: '中文' };

const STRINGS = {
  // welcome + pairing (2D page)
  'app.name': ['Still Water', '静水'],
  'welcome.sub': ['Your music, films and karaoke, on a quiet lake.', '在宁静的湖面上，听你的音乐、看你的影片、唱你的歌。'],
  'welcome.counts': ['{music} songs and {video} videos on your NAS.', 'NAS 上有 {music} 首歌曲、{video} 个视频。'],
  'welcome.empty': ['No media yet — add your NAS folders on the PC: http://localhost:8080/setup', '还没有媒体 —— 请在电脑上添加 NAS 文件夹：http://localhost:8080/setup'],
  'welcome.enterVr': ['Enter VR', '进入 VR'],
  'welcome.checkingVr': ['Checking VR…', '正在检查 VR…'],
  'welcome.noVr': ['VR not available here', '此设备无法进入 VR'],
  'welcome.preview': ['Desktop preview', '桌面预览'],
  'welcome.openInQuest': ['Open this page in the Quest browser to enter VR.', '请在 Quest 浏览器中打开本页面以进入 VR。'],
  'welcome.needHttps': ['VR needs HTTPS — open the https:// address.', 'VR 需要 HTTPS —— 请打开 https:// 开头的地址。'],
  'welcome.vrFailed': ['Could not start VR: {msg}', '无法启动 VR：{msg}'],
  'welcome.hubDown': ["Can't reach the hub: {msg}", '无法连接到电脑上的 Hub：{msg}'],
  'pair.title': ['Pair this <span>headset</span>', '配对<span>此头显</span>'],
  'pair.sub': ['Type the 6-digit code shown in the Media Room Hub window on your PC.', '请输入电脑上 Media Room Hub 窗口中显示的 6 位配对码。'],
  'pair.button': ['Pair', '配对'],
  'pair.digit': ['Digit {n}', '第 {n} 位'],
  'err.wrong-code': ['That code is not right. Check the code on the PC.', '配对码不正确，请核对电脑上显示的配对码。'],
  'err.too-many': ['Too many attempts. Wait 15 minutes, or check the code on the PC.', '尝试次数过多。请等 15 分钟，或查看电脑上的配对码。'],
  'hud.keys': [
    'Drag to look · Click to use · <kbd>1</kbd> Music <kbd>2</kbd> Cinema <kbd>3</kbd> Karaoke · <kbd>Space</kbd> play/pause · <kbd>L</kbd> library · <kbd>Esc</kbd> menu',
    '拖动查看 · 点击操作 · <kbd>1</kbd> 音乐 <kbd>2</kbd> 影院 <kbd>3</kbd> K歌 · <kbd>空格</kbd> 播放/暂停 · <kbd>L</kbd> 媒体库 · <kbd>Esc</kbd> 菜单',
  ],
  'hud.counts': ['{music} songs · {video} videos', '{music} 首歌 · {video} 个视频'],
  'lang.switch': ['中文', 'EN'], // the button shows the *other* language

  // connect anywhere (public page → your hub over the encrypted link)
  'link.connecting': ['Connecting to your hub…', '正在连接你的电脑…'],
  'link.offline': ['Your hub is offline — is the PC at home on, with Media Room running?', '你的电脑离线 —— 家里的电脑开着并在运行 Media Room 吗？'],
  'link.failed': ["Couldn't reach your hub: {msg}", '无法连接到你的电脑：{msg}'],
  'link.noHub': ['Open this page from your Media Room hub, or set up “connect anywhere”.', '请从 Media Room 电脑端打开此页面，或先设置「随处连接」。'],
  'link.blocked': ["Your hub was found, but the connection didn't get through. Try again in a moment.", '找到了你的电脑，但连接没有成功。请稍后再试。'],
  'hands.hint1': ['Pinch to select · or touch a button', '捏合手指选择 · 或直接触碰按钮'],
  'hands.hint2': ['Show your palm to bring the menu to you', '手掌朝向自己，菜单就会来到面前'],
  'connect.retry': ['Try again', '重试'],
  'connect.pairTitle': ['Pair this headset', '配对此头显'],
  'connect.pairSub': ['Type the 6-digit code shown in the Media Room Hub window on your PC', '输入电脑上 Media Room Hub 窗口中的 6 位配对码'],
  'connect.wrongCode': ["That code didn't work. Check the code on the PC and try again.", '配对码不对。请看电脑上的配对码再试一次。'],
  'connect.noHub': ['No hub set up yet.', '还没有设置电脑端。'],
  'link.route.lan': ['Home network', '家庭网络'],
  'link.route.direct': ['Away · direct link', '外出 · 直连'],
  'link.route.relay': ['Away · via relay', '外出 · 中转'],
  'link.state.idle': ['Not connected', '未连接'],
  'link.state.connecting': ['Connecting…', '连接中…'],
  'link.state.open': ['Connected', '已连接'],
  'link.state.offline': ['Hub offline', '电脑离线'],
  'link.state.failed': ['Connection failed', '连接失败'],
  'setup.s5': ['5 · Away from home', '5 · 外出使用'],
  'setup.remote': ['Let paired headsets reach this hub from anywhere (direct encrypted link)', '允许已配对的头显在任何地方连接到这台电脑（直连加密）'],
  'setup.signal': ['Meeting point address', '连接服务地址'],
  'setup.remoteOn': ['Ready: headsets can connect from anywhere.', '已就绪：头显可在任何地方连接。'],
  'setup.remoteConnecting': ['Connecting to the meeting point…', '正在连接服务…'],
  'setup.remoteOff': ['Off — home network only.', '已关闭 —— 仅限家庭网络。'],
  'setup.remoteNoSignal': ['Needs a meeting point address (see README → Connect anywhere).', '需要填写连接服务地址（见 README →「随处连接」）。'],
  'setup.remotePeers': [' · {n} headset(s) connected now', ' · 当前已连接 {n} 台头显'],
  'setup.save': ['Save', '保存'],

  // modes + console
  'mode.idle': ['Room', '房间'],
  'mode.music': ['Music', '音乐'],
  'mode.cinema': ['Cinema', '影院'],
  'mode.karaoke': ['Sing', 'K歌'],
  'console.library': ['Library', '媒体库'],
  'console.nothing': ['Nothing playing', '暂无播放'],

  // library panel
  'lib.music': ['Music', '音乐'],
  'lib.video': ['Videos', '视频'],
  'lib.karaoke': ['Karaoke', 'K歌'],
  'lib.nas': ['NAS folders', 'NAS 文件夹'],
  'lib.nasEmpty': ['No videos or music in this folder — open a sub-folder', '这个文件夹里没有视频或音乐 —— 打开子文件夹看看'],
  'lib.addToLibrary': ['+ Add to library', '+ 加入媒体库'],
  'lib.inLibrary': ['In your library ✓', '已在媒体库 ✓'],
  'lib.adding': ['Adding…', '正在加入…'],
  'lib.added': ['Added — scanning ✓', '已加入 —— 正在扫描 ✓'],
  'lib.back': ['‹ Back', '‹ 返回'],
  'lib.folder': ['Folder', '文件夹'],
  'lib.loading': ['Loading…', '加载中…'],
  'lib.notPaired': ['This headset is not paired.', '此头显尚未配对。'],
  'lib.loadFailed': ["Couldn't load: {msg}", '加载失败：{msg}'],
  'lib.empty': ['Nothing here yet — add folders on the PC: http://localhost:8080/setup', '这里还没有内容 —— 请在电脑上添加文件夹：http://localhost:8080/setup'],
  'lib.emptyKaraoke': ['No karaoke songs yet — play any song in Music and press “Sing this”', '还没有 K 歌曲目 —— 在「音乐」里播放任意歌曲，再点「唱这首」'],
  'lib.ready': ['Ready to sing', '可以唱了'],
  'lib.queued': ['Waiting…', '排队中…'],
  'lib.preparing': ['Preparing {pct}%', '准备中 {pct}%'],
  'lib.failed': ['Could not prepare', '准备失败'],

  // music screen
  'music.pick': ['Pick some music', '选一首音乐'],
  'music.pickHint': ['Open the Library on your console (or press L)', '打开控制台上的「媒体库」（或按 L）'],
  'music.nowPlaying': ['NOW PLAYING', '正在播放'],
  'music.paused': ['PAUSED', '已暂停'],
  'music.upNext': ['Up next · {title}', '下一首 · {title}'],
  'music.cantPlay': ['This file could not be played.', '此文件无法播放。'],
  'music.findingLyrics': ['Looking for lyrics…', '正在查找歌词…'],
  'music.noLyrics': ['No lyrics found for this song', '没有找到这首歌的歌词'],
  'action.sing': ['Sing this', '唱这首'],
  'action.prepare': ['Make karaoke', '制作伴奏'],
  'action.queued': ['Karaoke: waiting', '伴奏：排队中'],
  'action.preparing': ['Karaoke {pct}%', '伴奏 {pct}%'],
  'action.failed': ['Karaoke failed — retry', '伴奏失败 —— 重试'],
  'action.video': ['Watch video', '看视频'],
  'action.noTools': ['Karaoke tools are not installed on the PC', '电脑上没有安装 K 歌工具'],
  'action.readyToast': ['“{title}” is ready to sing!', '《{title}》可以唱了！'],

  // cinema
  'cinema.opening': ['Opening…', '正在打开…'],
  'cinema.buffering': ['Buffering…', '缓冲中…'],
  'cinema.cantPlay': ['This video could not be played.', '此视频无法播放。'],
  'cinema.cantOpen': ["Can't open: {msg}", '无法打开：{msg}'],
  'cinema.resumed': ['Resumed at {time}', '从 {time} 继续播放'],
  'cinema.noSubs': ['No subtitles for this video', '此视频没有字幕'],
  'cinema.subsOff': ['Subtitles off', '字幕已关闭'],
  'cinema.subsOn': ['Subtitles: {label}', '字幕：{label}'],
  'cinema.lyrics': ['Lyrics', '歌词'],
  'cinema.choose': ['Choose a video from the Library', '从媒体库中选择一个视频'],

  // karaoke
  'karaoke.title': ['Karaoke', '卡拉OK'],
  'karaoke.pick': ['Open the Library and pick a song to sing', '打开媒体库，选一首歌来唱'],
  'karaoke.loading': ['Getting the song ready…', '正在准备歌曲…'],
  'karaoke.loadFailed': ['That song could not be loaded.', '这首歌无法加载。'],
  'karaoke.demo': ['Demo singer', '演示歌手'],
  'karaoke.inTune': ['In tune for {s} s', '连续唱准 {s} 秒'],
  'karaoke.micOn': ['Mic on', '麦克风已开'],
  'karaoke.micOff': ['Mic off', '麦克风未开'],
  'karaoke.micDenied': ['Microphone not allowed', '麦克风未授权'],
  'karaoke.noMic': ['No microphone', '没有麦克风'],
  'karaoke.paused': ['paused', '已暂停'],
  'karaoke.getReady': ['Get ready…', '准备…'],
  'karaoke.go': ['Sing!', '开唱！'],
  'karaoke.readyHint': ['Sing when the words light up', '歌词亮起时开始唱'],
  'karaoke.voice': ['My voice {p}%', '我的声音 {p}%'],
  'karaoke.voiceOff': ['My voice off', '我的声音 关'],
  'karaoke.echoOn': ['Echo on', '回声 开'],
  'karaoke.echoOff': ['Echo off', '回声 关'],
  'score.lovely': ['Lovely!', '真好听！'],
  'score.quiet': ["I couldn't hear singing this time — try a little louder", '这次没听到歌声 —— 试着大声一点'],
  'score.noMic': ['Turn the microphone on to get a score', '打开麦克风才能评分'],
  'score.longest': ['Longest run in tune: {s} s', '最长连续唱准：{s} 秒'],
  'score.again': ['Open the Library to sing again or pick another song', '打开媒体库再唱一次，或换一首歌'],
  'score.titles': [['Ripple', 'Wave', 'Tide', 'Moonrise', 'Constellation'], ['涟漪', '浪花', '潮汐', '月升', '星河']],

  // setup page
  'setup.title': ['Media Room <span class="muted" style="font-weight:400">setup</span>', 'Media Room <span class="muted" style="font-weight:400">设置</span>'],
  'setup.open': ['Open the room', '打开房间'],
  'setup.s1': ['1 · Connect your headset', '1 · 连接头显'],
  'setup.s1.help': ['In the Quest browser, open this address. The first time, tap <b>Advanced → Proceed</b> on the security warning, then type the code.', '在 Quest 浏览器中打开下面的地址。第一次会看到安全警告，请点<b>「高级 → 继续前往」</b>，然后输入配对码。'],
  'setup.code': ['Pairing code', '配对码'],
  'setup.forget': ['Forget', '移除'],
  'setup.paired': ['Paired {when} · last seen {seen}', '配对于 {when} · 最近使用 {seen}'],
  'setup.never': ['never', '从未'],
  'setup.s2': ['2 · Find your NAS', '2 · 查找 NAS'],
  'setup.find': ['Find my NAS', '查找我的 NAS'],
  'setup.find.help': ['Looks for file servers on your home network. Takes about 5 seconds.', '在家庭网络中查找文件服务器，大约需要 5 秒。'],
  'setup.searching': ['Searching your home network…', '正在搜索家庭网络…'],
  'setup.found': ['Found {n} device(s) with shared folders on {nets}.', '在 {nets} 上找到 {n} 台有共享文件夹的设备。'],
  'setup.none': ['No file servers found. Is the NAS on, and on the same network as this PC?', '没有找到文件服务器。NAS 是否已开机，并且和这台电脑在同一网络？'],
  'setup.searchFailed': ['Search failed: {msg}', '搜索失败：{msg}'],
  'setup.connect': ['Connect', '连接'],
  'setup.opening': ['opening…', '正在打开…'],
  'setup.up': ['‹ Up', '‹ 上一级'],
  'setup.addMusic': ['Add as Music', '添加为音乐'],
  'setup.addVideo': ['Add as Videos', '添加为视频'],
  'setup.login': ['This NAS needs a login:', '此 NAS 需要登录：'],
  'setup.user': ['User name', '用户名'],
  'setup.pass': ['Password', '密码'],
  'setup.signIn': ['Sign in', '登录'],
  'setup.credNote': ['Saved by Windows Credential Manager, not by Media Room.', '密码由 Windows 凭据管理器保存，Media Room 不保存。'],
  'setup.loginFailed': ['That login did not work.', '登录失败。'],
  'setup.noSub': ['No sub-folders here. You can add this folder with the buttons above.', '这里没有子文件夹，可以用上面的按钮添加当前文件夹。'],
  'setup.byPath': ['Add a folder by path instead', '改为按路径添加文件夹'],
  'setup.s3': ['3 · Your library', '3 · 你的媒体库'],
  'setup.rescan': ['Rescan', '重新扫描'],
  'setup.counts': ['{music} songs · {video} videos', '{music} 首歌 · {video} 个视频'],
  'setup.skipped': [' · {n} skipped (formats no browser can play)', ' · 跳过 {n} 个（浏览器无法播放的格式）'],
  'setup.scanning': ['Scanning… {files} files in {folders} folders', '扫描中… {folders} 个文件夹中的 {files} 个文件'],
  'setup.tagging': [' · reading titles and covers {done} / {total}', ' · 正在读取歌名和封面 {done} / {total}'],
  'setup.noSources': ['No folders yet. Find your NAS above and add its music and video folders.', '还没有文件夹。请在上方查找 NAS，并添加音乐和视频文件夹。'],
  'setup.remove': ['Remove', '移除'],
  'setup.kind.music': ['Music', '音乐'],
  'setup.kind.video': ['Videos', '视频'],
  'setup.hubDown': ['The hub is not answering.', 'Hub 没有响应。'],
  'setup.s4': ['4 · Lyrics and karaoke', '4 · 歌词与 K 歌'],
  'setup.online': ['Look up missing lyrics on lrclib.net (sends only the artist and song title)', '在 lrclib.net 查找缺少的歌词（只发送歌手和歌名）'],
  'setup.karaokeTools': ['Karaoke preparation tools: {state}', 'K 歌准备工具：{state}'],
  'setup.installed': ['installed', '已安装'],
  'setup.missing': ['not installed — see README', '未安装 —— 见 README'],
  'setup.jobs': ['{ready} songs ready to sing · {queue} being prepared', '{ready} 首可唱 · {queue} 首准备中'],
  'err.setup-pc-only': ['Setup can only be changed on the PC running the hub.', '只能在运行 Hub 的电脑上更改设置。'],
  'err.folder-open': ['That folder could not be opened from this PC.', '这台电脑无法打开该文件夹。'],
  'err.already-added': ['Already added.', '已经添加过了。'],
};

let lang = store.get('lang', null) || (/^zh/i.test(navigator.language || '') ? 'zh' : 'en');
const listeners = new Set();
const col = () => (lang === 'zh' ? 1 : 0);

/** t('music.upNext', { title }) → "Up next · …" / "下一首 · …" */
export function t(key, vars) {
  const row = STRINGS[key];
  let s = row ? row[col()] : key;
  if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}

export const getLang = () => lang;
export const locale = () => (lang === 'zh' ? 'zh-CN' : 'en-US');
export const num = (n) => Number(n || 0).toLocaleString(locale());

export function setLang(l) {
  if (!LANGS[l] || l === lang) return;
  lang = l;
  store.set('lang', l);
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
  for (const fn of listeners) fn(l);
}
export const toggleLang = () => setLang(lang === 'zh' ? 'en' : 'zh');
export const onLang = (fn) => listeners.add(fn);

/** Chinese UI → Simplified lyrics (lrclib often has Traditional); English UI → as published. */
export const lyricsScript = () => (lang === 'zh' ? 'simplified' : 'original');

/** Fill every [data-i18n] / [data-i18n-html] / [data-i18n-placeholder] element on a 2D page. */
export function applyDom(root = document) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
}

/** Translate a hub error (by code when the hub sends one). */
export function errorText(e) {
  const code = e?.data?.code || e?.code;
  return code && STRINGS[`err.${code}`] ? t(`err.${code}`) : e?.message || String(e);
}
