// 全站数据：导航、统计、课程、教练、课表、会员套餐、口碑、FAQ、场馆信息。
// 所有内容为简体中文；价格为人民币 ¥；时间为 HH:mm-HH:mm。

export type CourseCategory = "力量" | "有氧" | "柔韧" | "搏击";
export type Intensity = "低" | "中" | "高";
export type WeekDay = "周一" | "周二" | "周三" | "周四" | "周五" | "周六" | "周日";

export interface NavItem {
  href: string;
  label: string;
}

export interface Stat {
  id: string;
  value: string;
  label: string;
}

export interface Course {
  id: string;
  name: string;
  category: CourseCategory;
  intensity: Intensity;
  duration: number; // 分钟
  calories: number; // 大卡
  summary: string;
  description: string;
}

export interface Trainer {
  id: string;
  name: string;
  title: string;
  specialties: string[];
  experienceYears: number;
  hue: number; // 头像底色 HSL hue
  bio: string;
}

export interface ScheduleItem {
  id: string;
  day: WeekDay;
  time: string;
  courseName: string;
  trainerName: string;
  room: string;
}

export interface MembershipTier {
  id: string;
  name: string;
  monthly: number; // 月付价（¥）
  yearly: number; // 年付价（¥）
  highlight?: boolean;
  perks: string[];
}

export interface Testimonial {
  id: string;
  name: string;
  role: string;
  quote: string;
  hue: number;
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
}

export interface StudioInfo {
  brand: string;
  slogan: string;
  address: string;
  phone: string;
  email: string;
  hours: string;
  metro: string;
}

// ---------- 数据 ----------

export const studioInfo: StudioInfo = {
  brand: "源动 FITNESS",
  slogan: "唤醒每一天的原动力",
  address: "上海市浦东新区世纪大道 1234 号 源动力中心 3F",
  phone: "400-880-1234",
  email: "hello@yuan-dong.fit",
  hours: "周一至周日 06:00 - 23:30",
  metro: "地铁 2 号线 世纪大道站 4 号口 步行 320 米",
};

export const nav: NavItem[] = [
  { href: "/", label: "首页" },
  { href: "/courses", label: "训练课程" },
  { href: "/trainers", label: "教练团队" },
  { href: "/schedule", label: "周课表" },
  { href: "/membership", label: "会员价格" },
  { href: "/contact", label: "联系 / 预约" },
];

export const navLinks: NavItem[] = nav;

export function navHref(item: NavItem): string {
  return item.href;
}

export const stats: Stat[] = [
  { id: "members", value: "12,000+", label: "活跃会员" },
  { id: "trainers", value: "38", label: "认证教练" },
  { id: "courses", value: "120+", label: "每月课程" },
  { id: "years", value: "9", label: "深耕年限" },
];

export const courseCategories: ("全部" | CourseCategory)[] = [
  "全部",
  "力量",
  "有氧",
  "柔韧",
  "搏击",
];

export const courses: Course[] = [
  {
    id: "c-hiit-burn",
    name: "HIIT 燃脂冲刺",
    category: "有氧",
    intensity: "高",
    duration: 45,
    calories: 520,
    summary: "30 秒冲刺 + 30 秒恢复，最大化燃脂窗口。",
    description:
      "高强度间歇训练，通过短时爆发与主动恢复交替，30 分钟内显著拉升心率与代谢，是减脂与心肺能力提升的王牌课程。",
  },
  {
    id: "c-power-base",
    name: "基础力量塑形",
    category: "力量",
    intensity: "中",
    duration: 60,
    calories: 380,
    summary: "深蹲、硬拉、卧推三大项入门到进阶。",
    description:
      "围绕深蹲、硬拉、卧推三大复合动作，系统学习动作模式与发力次序，帮助新手建立稳定、有力、好看的身体基础。",
  },
  {
    id: "c-deadlift-strong",
    name: "硬拉力量营",
    category: "力量",
    intensity: "高",
    duration: 60,
    calories: 450,
    summary: "针对性突破硬拉瓶颈，强化后侧链。",
    description:
      "聚焦硬拉专项技术，从启动位、锁定到离心控制全面打磨，配合辅助动作（罗马尼亚硬拉、 deficit 硬拉）突破瓶颈。",
  },
  {
    id: "c-spin-climb",
    name: "动感单车·爬坡",
    category: "有氧",
    intensity: "高",
    duration: 50,
    calories: 600,
    summary: "音乐节拍 + 阻爬坡，全身燃脂派对。",
    description:
      "跟随节奏感极强的歌单完成爬坡、冲刺、恢复循环，结合上肢与核心发力，让燃脂像派对一样上瘾。",
  },
  {
    id: "c-boxing-combo",
    name: "搏击组合课",
    category: "搏击",
    intensity: "高",
    duration: 55,
    calories: 580,
    summary: "直拳、勾拳、摆拳 + 步法，解压又塑形。",
    description:
      "将拳击基本功（直拳、勾拳、摆拳、躲闪）编入组合与靶位训练，燃脂高效、压力释放、协调性与爆发力一并提升。",
  },
  {
    id: "c-muay-thai",
    name: "泰拳基础",
    category: "搏击",
    intensity: "中",
    duration: 60,
    calories: 540,
    summary: "八体艺术：拳、肘、膝、腿系统入门。",
    description:
      "从站架、步法到拳肘膝腿的攻防组合，感受泰拳独特的节奏与气场，掌握一门真正能保护自己的技艺。",
  },
  {
    id: "c-yoga-flow",
    name: "流瑜伽 Vinyasa",
    category: "柔韧",
    intensity: "低",
    duration: 60,
    calories: 220,
    summary: "呼吸串联体式，舒展身心。",
    description:
      "通过呼吸串联一组流动体式，温和拉升肌肉与关节活动度，帮助长时间伏案的人释放颈肩与下背紧张。",
  },
  {
    id: "c-pilates-core",
    name: "普拉提核心",
    category: "柔韧",
    intensity: "中",
    duration: 50,
    calories: 260,
    summary: "深层核心激活，重塑体态线条。",
    description:
      "聚焦深层核心、骨盆稳定与脊柱中立，配合器械辅助训练，改善体态、缓解腰背酸痛、收紧腰腹线条。",
  },
  {
    id: "c-stretch-recover",
    name: "筋膜放松课",
    category: "柔韧",
    intensity: "低",
    duration: 40,
    calories: 150,
    summary: "泡沫轴 + 静态拉伸，加速恢复。",
    description:
      "结合泡沫轴、筋膜球与静态拉伸，针对久坐与高强度训练后的紧张肌群做系统放松，提升睡眠与训练恢复效率。",
  },
  {
    id: "c-cross-train",
    name: "功能性体能循环",
    category: "力量",
    intensity: "高",
    duration: 50,
    calories: 480,
    summary: "战绳、药球、跳箱多站循环。",
    description:
      "以 WOD 形式组织战绳、药球、跳箱、攀爬等多站动作，全面提升力量、爆发、协调与心肺，是体能爱好者的最爱。",
  },
  {
    id: "c-zumba-dance",
    name: "尊巴热舞",
    category: "有氧",
    intensity: "中",
    duration: 50,
    calories: 420,
    summary: "拉丁节拍里的有氧派对。",
    description:
      "融合桑巴、雷鬼、嘻哈元素的舞蹈有氧，零基础也能轻松跟跳，是出汗解压、交朋友的快乐课堂。",
  },
  {
    id: "c-mma-sparring",
    name: "MMA 综合格斗",
    category: "搏击",
    intensity: "高",
    duration: 60,
    calories: 620,
    summary: "站立 + 地面，综合格斗进阶。",
    description:
      "在拳击与泰拳基础上加入摔法与巴西柔术地面控制，适合有一定基础、希望挑战综合格斗的进阶者。",
  },
];

export const trainers: Trainer[] = [
  {
    id: "t-chen-siyuan",
    name: "陈思远",
    title: "金牌私教 · 力量训练总监",
    specialties: ["力量塑形", "硬拉专项", "体态矫正"],
    experienceYears: 11,
    hue: 142,
    bio: "前省队举重运动员，NSCA-CSCS 认证，擅长把复杂的力量训练拆解为零基础也能掌握的系统课程。",
  },
  {
    id: "t-lin-xiaoman",
    name: "林晓曼",
    title: "团课明星教练",
    specialties: ["HIIT", "动感单车", "燃脂塑形"],
    experienceYears: 7,
    hue: 88,
    bio: "音乐与节拍掌控大师，把每一节单车课都做成全场齐喊的派对，会员出勤率长年第一。",
  },
  {
    id: "t-zhao-yifan",
    name: "赵一帆",
    title: "搏击主教练",
    specialties: ["泰拳", "拳击", "MMA"],
    experienceYears: 9,
    hue: 22,
    bio: "WBC 泰拳职业赛经验，曾赴泰国 Petchyindee 训练营深造，技术扎实、风格硬朗。",
  },
  {
    id: "t-su-jingwen",
    name: "苏婧雯",
    title: "普拉提与瑜伽导师",
    specialties: ["流瑜伽", "普拉提", "产后修复"],
    experienceYears: 8,
    hue: 280,
    bio: "Polestar 普拉提认证，专注体态修复与女性健康，温柔而精准的教学风格深受白领会员喜爱。",
  },
  {
    id: "t-wang-zihao",
    name: "王梓豪",
    title: "功能性体能教练",
    specialties: ["CrossTraining", "运动表现", "减脂"],
    experienceYears: 6,
    hue: 200,
    bio: "CrossFit Level 2 认证，擅长用循环训练与多关节动作帮助会员突破瓶颈、提升综合体能。",
  },
  {
    id: "t-gu-yuxin",
    name: "顾雨欣",
    title: "营养与体态顾问",
    specialties: ["减脂营养", "体态评估", "饮食计划"],
    experienceYears: 10,
    hue: 320,
    bio: "注册营养师 RD，把饮食和训练打通成一套可坚持的生活方式，让训练成果真正在镜子里看得见。",
  },
];

const days: WeekDay[] = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export const weekDays: ("全部" | WeekDay)[] = ["全部", ...days];

export const schedule: ScheduleItem[] = [
  // 周一
  { id: "s-m1", day: "周一", time: "07:00-08:00", courseName: "晨光流瑜伽", trainerName: "苏婧雯", room: "瑜伽厅" },
  { id: "s-m2", day: "周一", time: "12:30-13:30", courseName: "燃脂 HIIT", trainerName: "林晓曼", room: "团课厅 A" },
  { id: "s-m3", day: "周一", time: "19:00-20:00", courseName: "基础力量塑形", trainerName: "陈思远", room: "力量区" },
  { id: "s-m4", day: "周一", time: "20:15-21:15", courseName: "动感单车·爬坡", trainerName: "林晓曼", room: "单车厅" },
  // 周二
  { id: "s-t1", day: "周二", time: "10:00-11:00", courseName: "普拉提核心", trainerName: "苏婧雯", room: "普拉提厅" },
  { id: "s-t2", day: "周二", time: "12:30-13:30", courseName: "搏击组合课", trainerName: "赵一帆", room: "搏击区" },
  { id: "s-t3", day: "周二", time: "19:00-20:00", courseName: "功能性体能循环", trainerName: "王梓豪", room: "功能区" },
  { id: "s-t4", day: "周二", time: "20:15-21:15", courseName: "尊巴热舞", trainerName: "林晓曼", room: "团课厅 A" },
  // 周三
  { id: "s-w1", day: "周三", time: "07:00-08:00", courseName: "晨光流瑜伽", trainerName: "苏婧雯", room: "瑜伽厅" },
  { id: "s-w2", day: "周三", time: "12:30-13:30", courseName: "硬拉力量营", trainerName: "陈思远", room: "力量区" },
  { id: "s-w3", day: "周三", time: "19:00-20:00", courseName: "HIIT 燃脂冲刺", trainerName: "林晓曼", room: "团课厅 A" },
  { id: "s-w4", day: "周三", time: "20:30-21:30", courseName: "泰拳基础", trainerName: "赵一帆", room: "搏击区" },
  // 周四
  { id: "s-th1", day: "周四", time: "10:00-11:00", courseName: "普拉提核心", trainerName: "苏婧雯", room: "普拉提厅" },
  { id: "s-th2", day: "周四", time: "12:30-13:30", courseName: "动感单车·爬坡", trainerName: "林晓曼", room: "单车厅" },
  { id: "s-th3", day: "周四", time: "19:00-20:00", courseName: "搏击组合课", trainerName: "赵一帆", room: "搏击区" },
  { id: "s-th4", day: "周四", time: "20:15-21:15", courseName: "筋膜放松课", trainerName: "苏婧雯", room: "瑜伽厅" },
  // 周五
  { id: "s-f1", day: "周五", time: "07:00-08:00", courseName: "晨光流瑜伽", trainerName: "苏婧雯", room: "瑜伽厅" },
  { id: "s-f2", day: "周五", time: "12:30-13:30", courseName: "功能性体能循环", trainerName: "王梓豪", room: "功能区" },
  { id: "s-f3", day: "周五", time: "19:00-20:00", courseName: "基础力量塑形", trainerName: "陈思远", room: "力量区" },
  { id: "s-f4", day: "周五", time: "20:15-21:30", courseName: "MMA 综合格斗", trainerName: "赵一帆", room: "搏击区" },
  // 周六
  { id: "s-sa1", day: "周六", time: "09:00-10:00", courseName: "HIIT 燃脂冲刺", trainerName: "林晓曼", room: "团课厅 A" },
  { id: "s-sa2", day: "周六", time: "10:30-11:30", courseName: "硬拉力量营", trainerName: "陈思远", room: "力量区" },
  { id: "s-sa3", day: "周六", time: "14:00-15:00", courseName: "普拉提核心", trainerName: "苏婧雯", room: "普拉提厅" },
  { id: "s-sa4", day: "周六", time: "16:00-17:00", courseName: "搏击组合课", trainerName: "赵一帆", room: "搏击区" },
  { id: "s-sa5", day: "周六", time: "18:30-19:30", courseName: "尊巴热舞", trainerName: "林晓曼", room: "团课厅 A" },
  // 周日
  { id: "s-su1", day: "周日", time: "09:30-10:30", courseName: "晨光流瑜伽", trainerName: "苏婧雯", room: "瑜伽厅" },
  { id: "s-su2", day: "周日", time: "11:00-12:00", courseName: "功能性体能循环", trainerName: "王梓豪", room: "功能区" },
  { id: "s-su3", day: "周日", time: "14:30-15:30", courseName: "筋膜放松课", trainerName: "苏婧雯", room: "瑜伽厅" },
  { id: "s-su4", day: "周日", time: "17:00-18:00", courseName: "动感单车·爬坡", trainerName: "林晓曼", room: "单车厅" },
];

export const membershipTiers: MembershipTier[] = [
  {
    id: "m-starter",
    name: "体验卡",
    monthly: 199,
    yearly: 1999,
    perks: [
      "每月 4 次团课任选",
      "公共器械区使用",
      "免费体测 1 次",
      "淋浴与储物柜",
    ],
  },
  {
    id: "m-standard",
    name: "标准会员",
    monthly: 499,
    yearly: 4999,
    highlight: true,
    perks: [
      "团课不限次",
      "力量 / 有氧 / 柔韧全专区通行",
      "每月 2 次私教体验课",
      "免费停车 2 小时",
      "营养咨询 1 对 1",
    ],
  },
  {
    id: "m-premium",
    name: "至尊年卡",
    monthly: 899,
    yearly: 8999,
    perks: [
      "全场馆 24H 不限时",
      "每月 8 次私教课",
      "搏击 / MMA 专区通行",
      " Guest Pass 每月 4 张",
      "专属储物柜 + 毛巾服务",
      "健康餐 8 折优惠",
    ],
  },
];

export const testimonials: Testimonial[] = [
  {
    id: "tm-1",
    name: "李小姐",
    role: "互联网产品经理 · 入会 2 年",
    quote: "下班顺路上一节 HIIT，半年体脂降了 8 个点，颈椎也不疼了，是工作日里最值得的一小时。",
    hue: 142,
  },
  {
    id: "tm-2",
    name: "张先生",
    role: "金融分析师 · 力量训练 3 年",
    quote: "陈教练把硬拉从入门到 180kg 拆得明明白白，每节课都能感觉到自己在变强。",
    hue: 88,
  },
  {
    id: "tm-3",
    name: "王女士",
    role: "新妈妈 · 产后修复 1 年",
    quote: "苏老师的普拉提温柔又精准，腹直肌分离从 4 指恢复到 1 指，整个人重新站稳了。",
    hue: 320,
  },
];

export const faqs: Faq[] = [
  {
    id: "f-1",
    question: "我没有运动基础，可以加入吗？",
    answer:
      "完全可以。我们为新会员提供 1 次免费体测 + 1 节私教体验课，教练会根据你的体能和目标制定循序渐进的方案，零基础也能安心开始。",
  },
  {
    id: "f-2",
    question: "会员卡可以转让或冻结吗？",
    answer:
      "标准会员与至尊年卡支持每年最长 30 天的冻结期（出差、生病、产假均可申请），转让需到店办理并支付 100 元手续费。",
  },
  {
    id: "f-3",
    question: "私教课怎么收费？",
    answer:
      "私教课按节购买，单节 380 元起；包年私教课最低可至 280 元/节。会员购买私教课可优先预约黄金时段。",
  },
  {
    id: "f-4",
    question: "提供淋浴和储物柜吗？",
    answer:
      "全场馆配备独立淋浴间、干湿分离更衣区与智能储物柜，标准会员以上可使用专属固定储物柜，提供浴巾与洗护用品。",
  },
  {
    id: "f-5",
    question: "课程需要提前预约吗？",
    answer:
      "团课与搏击课程建议在小程序提前 2 小时预约，确保名额；力量区与功能区开放时段内可自由使用，无需预约。",
  },
];
