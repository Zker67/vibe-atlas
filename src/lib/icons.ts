// The icons of projects and modules. Go keeps them as text (internal/store/
// icons.go): "" for the default, "lucide:<Name>", "emoji:<emoji>" or
// "image:<name>", a picture of the images folder.

import {
  Accessibility,
  AppWindow,
  BookOpen,
  Bot,
  Box,
  Boxes,
  Brain,
  Brush,
  Bug,
  Calendar,
  Camera,
  Castle,
  ChartLine,
  Clapperboard,
  Clock,
  Cloud,
  Code,
  Coffee,
  Coins,
  Compass,
  Cpu,
  Crosshair,
  Database,
  FileText,
  Flag,
  Flame,
  FolderKanban,
  Gamepad2,
  Gem,
  Ghost,
  Globe,
  Hammer,
  Heart,
  House,
  Image,
  Key,
  Keyboard,
  Languages,
  Layers,
  LayoutDashboard,
  Leaf,
  Lightbulb,
  Link,
  Lock,
  Mail,
  Map,
  MessageSquare,
  Monitor,
  Moon,
  Mountain,
  Music,
  Notebook,
  Package,
  Palette,
  PenTool,
  Plug,
  Puzzle,
  Rocket,
  Search,
  Server,
  Settings,
  Shield,
  ShoppingCart,
  Skull,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  Swords,
  Target,
  Terminal,
  TestTube,
  TreePine,
  Trophy,
  User,
  Users,
  Volume2,
  Wallet,
  WandSparkles,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface BuiltinIcon {
  name: string;
  icon: LucideIcon;
  /** Words it is found by, besides its name. */
  words: string;
}

/** The built-in icons, in the order the icon picker shows them. */
export const BUILTIN_ICONS: BuiltinIcon[] = [
  { name: "FolderKanban", icon: FolderKanban, words: "项目 文件夹 看板" },
  { name: "Boxes", icon: Boxes, words: "模块 盒子" },
  { name: "Box", icon: Box, words: "盒子 模块" },
  { name: "Package", icon: Package, words: "包 打包 发布" },
  { name: "Layers", icon: Layers, words: "层 图层 架构" },
  { name: "LayoutDashboard", icon: LayoutDashboard, words: "仪表盘 界面 布局 UI" },
  { name: "AppWindow", icon: AppWindow, words: "窗口 应用 桌面" },
  { name: "Monitor", icon: Monitor, words: "桌面 屏幕 显示" },
  { name: "Smartphone", icon: Smartphone, words: "手机 移动 App" },
  { name: "Globe", icon: Globe, words: "网站 网页 Web 全球" },
  { name: "Server", icon: Server, words: "服务器 后端" },
  { name: "Database", icon: Database, words: "数据库 数据 存储" },
  { name: "Cloud", icon: Cloud, words: "云 同步 部署" },
  { name: "Code", icon: Code, words: "代码 开发" },
  { name: "Terminal", icon: Terminal, words: "终端 命令行 CLI 脚本" },
  { name: "Cpu", icon: Cpu, words: "芯片 性能 硬件" },
  { name: "Bot", icon: Bot, words: "机器人 AI agent" },
  { name: "Sparkles", icon: Sparkles, words: "闪光 AI 魔法 特效" },
  { name: "Brain", icon: Brain, words: "大脑 AI 智能" },
  { name: "Gamepad2", icon: Gamepad2, words: "游戏 手柄" },
  { name: "Swords", icon: Swords, words: "武器 战斗 剑" },
  { name: "Shield", icon: Shield, words: "防御 安全 盾" },
  { name: "Crosshair", icon: Crosshair, words: "射击 准星 瞄准" },
  { name: "Skull", icon: Skull, words: "恐怖 骷髅 死亡" },
  { name: "Ghost", icon: Ghost, words: "幽灵 恐怖 鬼" },
  { name: "User", icon: User, words: "人物 角色 用户 账号" },
  { name: "Users", icon: Users, words: "团队 多人 社交" },
  { name: "Map", icon: Map, words: "地图 关卡 世界" },
  { name: "Mountain", icon: Mountain, words: "关卡 场景 山" },
  { name: "Castle", icon: Castle, words: "城堡 关卡 建筑" },
  { name: "TreePine", icon: TreePine, words: "场景 树 自然" },
  { name: "Music", icon: Music, words: "音乐 音频 BGM" },
  { name: "Volume2", icon: Volume2, words: "音效 声音 音频" },
  { name: "Image", icon: Image, words: "图片 美术 素材" },
  { name: "Palette", icon: Palette, words: "美术 配色 UI 主题" },
  { name: "Brush", icon: Brush, words: "画笔 美术 绘制" },
  { name: "PenTool", icon: PenTool, words: "设计 钢笔 矢量" },
  { name: "Camera", icon: Camera, words: "相机 拍照 镜头" },
  { name: "Clapperboard", icon: Clapperboard, words: "视频 动画 剧情 过场" },
  { name: "WandSparkles", icon: WandSparkles, words: "魔法 特效 技能" },
  { name: "Zap", icon: Zap, words: "闪电 性能 快" },
  { name: "Flame", icon: Flame, words: "火 热门" },
  { name: "Star", icon: Star, words: "星 收藏 重要" },
  { name: "Heart", icon: Heart, words: "心 喜欢 生命" },
  { name: "Trophy", icon: Trophy, words: "成就 奖杯 排行" },
  { name: "Gem", icon: Gem, words: "宝石 道具 装备" },
  { name: "Coins", icon: Coins, words: "金币 经济 货币" },
  { name: "ShoppingCart", icon: ShoppingCart, words: "商店 购物 商城" },
  { name: "Wallet", icon: Wallet, words: "钱包 支付 付费" },
  { name: "MessageSquare", icon: MessageSquare, words: "聊天 对话 消息" },
  { name: "Mail", icon: Mail, words: "邮件 信" },
  { name: "Settings", icon: Settings, words: "设置 配置" },
  { name: "Wrench", icon: Wrench, words: "工具 扳手 维护" },
  { name: "Hammer", icon: Hammer, words: "构建 工具 锤子" },
  { name: "Puzzle", icon: Puzzle, words: "插件 扩展 拼图 解谜" },
  { name: "Plug", icon: Plug, words: "接口 插件 连接" },
  { name: "Link", icon: Link, words: "链接 关联" },
  { name: "Key", icon: Key, words: "钥匙 账号 密钥" },
  { name: "Lock", icon: Lock, words: "锁 权限 安全" },
  { name: "Search", icon: Search, words: "搜索 查找" },
  { name: "ChartLine", icon: ChartLine, words: "图表 数据 统计 分析" },
  { name: "FileText", icon: FileText, words: "文档 文件 文本" },
  { name: "BookOpen", icon: BookOpen, words: "文档 说明 书 剧情" },
  { name: "Notebook", icon: Notebook, words: "笔记 记录" },
  { name: "Calendar", icon: Calendar, words: "日程 日历 活动" },
  { name: "Clock", icon: Clock, words: "时间 时钟" },
  { name: "Rocket", icon: Rocket, words: "发布 上线 启动" },
  { name: "Flag", icon: Flag, words: "里程碑 旗帜 目标" },
  { name: "Bug", icon: Bug, words: "调试 缺陷 bug" },
  { name: "TestTube", icon: TestTube, words: "测试 实验" },
  { name: "Lightbulb", icon: Lightbulb, words: "想法 灵感 创意" },
  { name: "Target", icon: Target, words: "目标 靶" },
  { name: "Compass", icon: Compass, words: "导航 方向 探索" },
  { name: "House", icon: House, words: "首页 家 主页" },
  { name: "Keyboard", icon: Keyboard, words: "键盘 输入 快捷键" },
  { name: "Languages", icon: Languages, words: "多语言 翻译 本地化" },
  { name: "Accessibility", icon: Accessibility, words: "无障碍 辅助" },
  { name: "Leaf", icon: Leaf, words: "自然 叶子 环保" },
  { name: "Sun", icon: Sun, words: "太阳 白天 亮色" },
  { name: "Moon", icon: Moon, words: "月亮 夜晚 暗色" },
  { name: "Coffee", icon: Coffee, words: "咖啡 休闲" },
];

const BY_NAME = new globalThis.Map(BUILTIN_ICONS.map((i) => [i.name, i.icon]));

/** Emoji offered first; any other can be typed in. */
export const EMOJIS = [
  "🎮", "👻", "💀", "⚔️", "🛡️", "🏰", "🗺️", "🧙",
  "🤖", "🧠", "✨", "🔥", "⚡", "🌟", "💎", "🪙",
  "🎵", "🎨", "🖌️", "📷", "🎬", "📱", "💻", "🖥️",
  "🌐", "☁️", "🗄️", "🔧", "🛠️", "🧩", "🔌", "🔑",
  "🔒", "📊", "📈", "📝", "📚", "📒", "📅", "⏰",
  "🚀", "🚩", "🐛", "🧪", "💡", "🎯", "🧭", "🏠",
  "⌨️", "🌍", "🍃", "🌙", "☀️", "☕", "🐱", "🐶",
  "🐟", "🦊", "🐉", "🌸", "🍀", "🎲", "🏆", "❤️",
];

export type ParsedIcon =
  | { kind: "default" }
  | { kind: "lucide"; icon: LucideIcon }
  | { kind: "emoji"; emoji: string }
  | { kind: "image"; name: string };

/** What an icon is; a built-in one this version does not know shows as the default. */
export function parseIcon(icon: string): ParsedIcon {
  if (icon.startsWith("lucide:")) {
    const c = BY_NAME.get(icon.slice(7));
    return c ? { kind: "lucide", icon: c } : { kind: "default" };
  }
  if (icon.startsWith("emoji:") && icon.length > 6) return { kind: "emoji", emoji: icon.slice(6) };
  if (icon.startsWith("image:")) return { kind: "image", name: icon.slice(6) };
  return { kind: "default" };
}

/** The icon a project shows: the one chosen, else the one found in its folder. */
export function projectIcon(p: { icon: string; detectedIcon: string }): string {
  return p.icon || p.detectedIcon;
}

/** Whether text is one emoji or a few, as an icon may be. */
export function isEmoji(text: string): boolean {
  const t = text.trim();
  return t !== "" && [...t].length <= 12 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(t) && !/\s/.test(t);
}
