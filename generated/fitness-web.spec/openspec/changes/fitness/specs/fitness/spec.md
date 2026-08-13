# 规格（Spec）：健身俱乐部官网

## 路由 / 页面
| 路径 | 文件 | 类型 | 说明 |
| --- | --- | --- | --- |
| `/` | `app/page.tsx` | Server | 首页：英雄、数据、精选课程、特色、口碑、CTA |
| `/courses` | `app/courses/page.tsx` | Client | 训练课程，分类筛选（useState） |
| `/trainers` | `app/trainers/page.tsx` | Server | 教练团队网格 |
| `/schedule` | `app/schedule/page.tsx` | Client | 周课表，按星期筛选（useState） |
| `/membership` | `app/membership/page.tsx` | Client | 会员套餐，月/年付切换 + FAQ（useState） |
| `/contact` | `app/contact/page.tsx` | Client | 预约表单（受控输入 + 成功态）+ 场馆信息 |

## 共享组件
- **TopNav**（`app/components/TopNav.tsx`，Client）：粘性顶栏，品牌 logo + 导航链接，
  使用 `usePathname()` 标记当前页；移动端汉堡菜单展开。
- **Footer**（`app/components/Footer.tsx`）：品牌信息、快速链接、联系方式、版权。
- **Section**（`app/components/Section.tsx`）：统一的章节容器（标题 + 副标题 + children）。
- **BmiCalculator**（`app/components/BmiCalculator.tsx`，Client）：身高/体重受控输入，
  实时计算 BMI 与分类（偏瘦/正常/超重/肥胖）。

## 数据模型（`lib/data.ts`）
所有数据均为强类型数组，导出 `nav`、`stats`、`courses`、`trainers`、`schedule`、
`membershipTiers`、`testimonials`、`faqs`、`studioInfo`。

```ts
type CourseCategory = '力量' | '有氧' | '柔韧' | '搏击';

interface Course {
  id: string;
  name: string;            // 课程名（中文）
  category: CourseCategory;
  intensity: '低' | '中' | '高';
  duration: number;        // 分钟
  calories: number;        // 大卡
  summary: string;         // 一句话介绍
  description: string;     // 详细介绍
}

interface Trainer {
  id: string;
  name: string;            // 中文名
  title: string;           // 头衔，如「金牌私教」
  specialties: string[];   // 擅长方向
  experienceYears: number; // 从业年限
  hue: number;             // 用于头像底色（HSL hue）
  bio: string;
}

type WeekDay = '周一' | '周二' | '周三' | '周四' | '周五' | '周六' | '周日';

interface ScheduleItem {
  id: string;
  day: WeekDay;
  time: string;            // 如 '19:00-20:00'
  courseName: string;
  trainerName: string;
  room: string;            // 如「力量区 A」
}

interface MembershipTier {
  id: string;
  name: string;            // 体验卡 / 标准会员 / 至尊年卡
  monthly: number;         // 月付价（¥）
  yearly: number;          // 年付价（¥）
  highlight?: boolean;     // 是否高亮推荐
  perks: string[];
}

interface Testimonial { id: string; name: string; role: string; quote: string; hue: number; }
interface Faq { id: string; question: string; answer: string; }
interface Stat { id: string; value: string; label: string; }
interface NavItem { href: string; label: string; }
```

## 关键交互
1. **课程筛选**：默认「全部」；点击「力量 / 有氧 / 柔韧 / 搏击」即时筛选；空结果时
   显示空态。
2. **课表筛选**：默认「全部」；切换周一~周日显示当日课程；卡片显示时间、课程、教练、
   教室。
3. **会员价格切换**：月付/年付 toggle，价格与单位切换；中间档高亮"最受欢迎"。
4. **FAQ 折叠**：点击问题展开/收起答案，单选式（同时只展开一个）。
5. **预约表单**：所有字段受控；提交 `preventDefault`；显示成功卡片（含用户姓名回填）；
   提供「再预约一次」按钮重置状态；基础校验（必填、手机号 11 位）。
6. **BMI 计算器**：身高 cm / 体重 kg 受控输入，实时输出 BMI 数值与分类标签。

## 内容语言
- 全站可见文案为**简体中文（zh-CN）**。
- 课程、教练、套餐名称均使用真实可信的中文名（如「HIIT 燃脂冲刺」「陈思远」「至尊
  年卡」等）。
- 价格单位 `¥`，时间格式 `HH:mm-HH:mm`。

## 视觉与设计
- **主题**：深色（zinc-950 / 黑）+ 青柠绿强调色（`#a9ff57`），活力、专业、高端。
- **响应式**：移动优先（375px 设计基准），`sm/md/lg` 断点递进；导航移动端折叠。
- **卡片**：圆角（`rounded-2xl`）、边框 + 半透明背景、hover 微动效。
- **字体**：使用模板已有的 Geist Sans / Mono；标题大号粗体。
- **图标**：内联 SVG 或 Unicode 字符，不引入额外图标库。

## 验收
- 6 条路由全部 200 可达。
- 全部交互组件为真实工作元素（`<button>` / `<a>` / `<Link>` / `<select>` / `<input>`）。
- `npm run build` 通过，无 error / warning。
