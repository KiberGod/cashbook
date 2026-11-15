// Built-in pictures for categories: a line glyph (24×24, drawn like the app's own icons) in white on
// a coloured circle. Stored as 'builtin:cat-<id>' or 'builtin:cat-<id>@<colour>' (see builtin.ts), so
// they never depend on a link; without a colour the icon wears its group's. A category may still use
// any picture link instead.

type L = { uk: string; en: string; ru: string };

export interface CategoryIcon {
  id: string;
  label: L;
  /** the circle's colour by default (a key of ICON_COLORS) */
  color: ColorKey;
  /** the glyph: SVG elements on a 24×24 grid, stroked */
  glyph: string;
}

const p = (...d: string[]) => d.map((x) => `<path d="${x}"/>`).join('');
const c = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const rect = (x: number, y: number, w: number, h: number, rx: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;

/** The colours an icon can wear: white glyphs stay readable on each of them. */
export const ICON_COLORS = {
  orange: '#F08C2E',
  amber: '#D19A12',
  red: '#E5484D',
  pink: '#D9488F',
  violet: '#7C5CE0',
  indigo: '#4F5BD5',
  blue: '#3B82F6',
  cyan: '#0E9CC2',
  teal: '#14A3A3',
  green: '#2E9E5B',
  brown: '#C2662D',
  gray: '#6B7684',
} as const;
export type ColorKey = keyof typeof ICON_COLORS;
export const COLOR_KEYS = Object.keys(ICON_COLORS) as ColorKey[];

// one colour per group by default, so a list of categories reads at a glance
const FOOD: ColorKey = 'orange';
const TRANSPORT: ColorKey = 'blue';
const HOME: ColorKey = 'teal';
const HEALTH: ColorKey = 'red';
const LEARN: ColorKey = 'violet';
const FUN: ColorKey = 'pink';
const SHOP: ColorKey = 'brown';
const MONEY: ColorKey = 'green';
const OTHER: ColorKey = 'gray';

const icon = (id: string, color: ColorKey, label: L, glyph: string): CategoryIcon => ({ id, color, label, glyph });

export const CATEGORY_ICON_GROUPS: { label: L; icons: CategoryIcon[] }[] = [
  {
    label: { uk: 'Їжа', en: 'Food', ru: 'Еда' },
    icons: [
      icon('food', FOOD, { uk: 'Їжа', en: 'Food', ru: 'Еда' }, p('M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7')),
      icon('groceries', FOOD, { uk: 'Продукти', en: 'Groceries', ru: 'Продукты' }, c(8, 21, 1) + c(19, 21, 1) + p('M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12')),
      icon('cafe', FOOD, { uk: 'Кава', en: 'Coffee', ru: 'Кофе' }, p('M10 2v2', 'M14 2v2', 'M6 2v2', 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1')),
      icon('fastfood', FOOD, { uk: 'Фастфуд', en: 'Fast food', ru: 'Фастфуд' }, p('M15 11h.01', 'M11 15h.01', 'M16 16h.01', 'm2 16 20 6-6-20A20 20 0 0 0 2 16', 'M5.71 17.11a17.04 17.04 0 0 1 11.4-11.42')),
      icon('drinks', FOOD, { uk: 'Напої', en: 'Drinks', ru: 'Напитки' }, p('M8 22h8', 'M7 10h10', 'M12 15v7', 'M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z')),
    ],
  },
  {
    label: { uk: 'Транспорт', en: 'Transport', ru: 'Транспорт' },
    icons: [
      icon('bus', TRANSPORT, { uk: 'Громадський транспорт', en: 'Public transport', ru: 'Общественный транспорт' }, p('M8 6v6', 'M15 6v6', 'M2 12h19.6', 'M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3', 'M9 18h5') + c(7, 18, 2) + c(16, 18, 2)),
      icon('car', TRANSPORT, { uk: 'Авто', en: 'Car', ru: 'Авто' }, p('M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2', 'M9 17h6') + c(7, 17, 2) + c(17, 17, 2)),
      icon('fuel', TRANSPORT, { uk: 'Пальне', en: 'Fuel', ru: 'Топливо' }, p('M3 22h12', 'M4 9h10', 'M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18', 'M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5')),
      icon('train', TRANSPORT, { uk: 'Потяг', en: 'Train', ru: 'Поезд' }, p('M8 3.1V7a4 4 0 0 0 8 0V3.1', 'm9 15-1-1', 'm15 15 1-1', 'M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z', 'm8 19-2 3', 'm16 19 2 3')),
      icon('plane', TRANSPORT, { uk: 'Подорожі', en: 'Travel', ru: 'Путешествия' }, p('M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z')),
      icon('bike', TRANSPORT, { uk: 'Велосипед', en: 'Bike', ru: 'Велосипед' }, c(18.5, 17.5, 3.5) + c(5.5, 17.5, 3.5) + c(15, 5, 1) + p('M12 17.5V14l-3-3 4-3 2 3h2')),
    ],
  },
  {
    label: { uk: 'Дім', en: 'Home', ru: 'Дом' },
    icons: [
      icon('home', HOME, { uk: 'Дім', en: 'Home', ru: 'Дом' }, p('M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8', 'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')),
      icon('rent', HOME, { uk: 'Оренда', en: 'Rent', ru: 'Аренда' }, p('m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4', 'm21 2-9.6 9.6') + c(7.5, 15.5, 5.5)),
      icon('building', HOME, { uk: 'Будинок', en: 'Building', ru: 'Здание' }, p('M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z', 'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2', 'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2', 'M10 6h4', 'M10 10h4', 'M10 14h4', 'M10 18h4')),
      icon('power', HOME, { uk: 'Електрика', en: 'Electricity', ru: 'Электричество' }, p('M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z')),
      icon('water', HOME, { uk: 'Вода', en: 'Water', ru: 'Вода' }, p('M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z')),
      icon('heating', HOME, { uk: 'Опалення, газ', en: 'Heating, gas', ru: 'Отопление, газ' }, p('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z')),
      icon('internet', HOME, { uk: 'Інтернет', en: 'Internet', ru: 'Интернет' }, p('M12 20h.01', 'M2 8.82a15 15 0 0 1 20 0', 'M5 12.86a10 10 0 0 1 14 0', 'M8.5 16.43a5 5 0 0 1 7 0')),
      icon('phone', HOME, { uk: 'Телефон', en: 'Phone', ru: 'Телефон' }, rect(5, 2, 14, 20, 2) + p('M12 18h.01')),
      icon('tv', HOME, { uk: 'Телебачення', en: 'TV', ru: 'Телевидение' }, rect(2, 7, 20, 15, 2) + p('m17 2-5 5-5-5')),
      icon('repair', HOME, { uk: 'Ремонт', en: 'Repairs', ru: 'Ремонт' }, p('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z')),
      icon('garden', HOME, { uk: 'Сад, рослини', en: 'Garden, plants', ru: 'Сад, растения' }, p('M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z', 'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12')),
    ],
  },
  {
    label: { uk: "Здоров'я та освіта", en: 'Health and learning', ru: 'Здоровье и обучение' },
    icons: [
      icon('health', HEALTH, { uk: "Здоров'я", en: 'Health', ru: 'Здоровье' }, p('M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z', 'M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27')),
      icon('pharmacy', HEALTH, { uk: 'Аптека', en: 'Pharmacy', ru: 'Аптека' }, p('m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z', 'm8.5 8.5 7 7')),
      icon('sport', HEALTH, { uk: 'Спорт', en: 'Sport', ru: 'Спорт' }, rect(4, 7, 4, 10, 1.5) + rect(16, 7, 4, 10, 1.5) + p('M8 12h8', 'M2 10v4', 'M22 10v4')),
      icon('education', LEARN, { uk: 'Навчання', en: 'Education', ru: 'Обучение' }, p('M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z', 'M22 10v6', 'M6 12.5V16a6 3 0 0 0 12 0v-3.5')),
      icon('books', LEARN, { uk: 'Книги', en: 'Books', ru: 'Книги' }, p('M12 7v14', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z')),
      icon('kids', LEARN, { uk: 'Діти', en: 'Kids', ru: 'Дети' }, p('M9 12h.01', 'M15 12h.01', 'M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5', 'M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1')),
      icon('pets', LEARN, { uk: 'Тварини', en: 'Pets', ru: 'Питомцы' }, c(11, 4, 2) + c(18, 8, 2) + c(20, 16, 2) + p('M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.05Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z')),
    ],
  },
  {
    label: { uk: 'Дозвілля', en: 'Leisure', ru: 'Досуг' },
    icons: [
      icon('movies', FUN, { uk: 'Кіно', en: 'Movies', ru: 'Кино' }, rect(3, 3, 18, 18, 2) + p('M7 3v18', 'M3 7.5h4', 'M3 12h18', 'M3 16.5h4', 'M17 3v18', 'M17 7.5h4', 'M17 16.5h4')),
      icon('games', FUN, { uk: 'Ігри', en: 'Games', ru: 'Игры' }, p('M6 11h4', 'M8 9v4', 'M15 12h.01', 'M18 10h.01', 'M17.32 5H6.68a4 4 0 0 0-3.98 3.59C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.41.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.55-.6-6.58-.69-7.26A4 4 0 0 0 17.32 5z')),
      icon('music', FUN, { uk: 'Музика', en: 'Music', ru: 'Музыка' }, p('M9 18V5l12-2v13') + c(6, 18, 3) + c(18, 16, 3)),
      icon('events', FUN, { uk: 'Події, квитки', en: 'Events, tickets', ru: 'События, билеты' }, p('M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z', 'M13 5v2', 'M13 17v2', 'M13 11v2')),
      icon('hobby', FUN, { uk: 'Хобі', en: 'Hobby', ru: 'Хобби' }, p('M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z', 'M13.5 6.5h.01', 'M17.5 10.5h.01', 'M6.5 12.5h.01', 'M8.5 7.5h.01')),
      icon('photo', FUN, { uk: 'Фото', en: 'Photo', ru: 'Фото' }, p('M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z') + c(12, 13, 3)),
      icon('hotel', FUN, { uk: 'Готель', en: 'Hotel', ru: 'Отель' }, p('M2 4v16', 'M2 8h18a2 2 0 0 1 2 2v10', 'M2 17h20', 'M6 8v9')),
    ],
  },
  {
    label: { uk: 'Покупки', en: 'Shopping', ru: 'Покупки' },
    icons: [
      icon('shopping', SHOP, { uk: 'Покупки', en: 'Shopping', ru: 'Покупки' }, p('M16 10a4 4 0 0 1-8 0', 'M3.1 6h17.8', 'M3.4 5.47a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.67a2 2 0 0 0-.4-1.2l-2-2.67A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z')),
      icon('clothes', SHOP, { uk: 'Одяг', en: 'Clothes', ru: 'Одежда' }, p('M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z')),
      icon('gift', SHOP, { uk: 'Подарунки', en: 'Gifts', ru: 'Подарки' }, rect(3, 8, 18, 4, 1) + p('M12 8v13', 'M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7', 'M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5')),
      icon('beauty', SHOP, { uk: 'Краса', en: 'Beauty', ru: 'Красота' }, p('M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z', 'M20 3v4', 'M22 5h-4')),
      icon('haircut', SHOP, { uk: 'Перукарня', en: 'Haircut', ru: 'Парикмахерская' }, c(6, 6, 3) + c(6, 18, 3) + p('M20 4 8.12 15.88', 'M14.47 14.48 20 20', 'M8.12 8.12 12 12')),
      icon('electronics', SHOP, { uk: 'Техніка', en: 'Electronics', ru: 'Техника' }, p('M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16')),
      icon('delivery', SHOP, { uk: 'Доставка', en: 'Delivery', ru: 'Доставка' }, p('M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z', 'M12 22V12', 'M3.29 7 12 12l8.71-5', 'm7.5 4.27 9 5.15')),
    ],
  },
  {
    label: { uk: 'Гроші', en: 'Money', ru: 'Деньги' },
    icons: [
      icon('salary', MONEY, { uk: 'Зарплата', en: 'Salary', ru: 'Зарплата' }, p('M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16') + rect(2, 6, 20, 14, 2)),
      icon('cash', MONEY, { uk: 'Готівка', en: 'Cash', ru: 'Наличные' }, rect(2, 6, 20, 12, 2) + c(12, 12, 2) + p('M6 12h.01', 'M18 12h.01')),
      icon('wallet', MONEY, { uk: 'Гаманець', en: 'Wallet', ru: 'Кошелёк' }, p('M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1', 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4')),
      icon('card', MONEY, { uk: 'Картка', en: 'Card', ru: 'Карта' }, rect(2, 5, 20, 14, 2) + p('M2 10h20')),
      icon('bank', MONEY, { uk: 'Банк', en: 'Bank', ru: 'Банк' }, p('M10 18v-7', 'M14 18v-7', 'M18 18v-7', 'M6 18v-7', 'M3 22h18', 'M11.12 2.2a2 2 0 0 1 1.76 0l7.87 3.85c.47.23.31.95-.22.95H3.47c-.53 0-.69-.72-.22-.95z')),
      icon('savings', MONEY, { uk: 'Заощадження', en: 'Savings', ru: 'Сбережения' }, p('M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z', 'M16 10h.01', 'M2 8v1a2 2 0 0 0 2 2h1')),
      icon('investments', MONEY, { uk: 'Інвестиції', en: 'Investments', ru: 'Инвестиции' }, p('M16 7h6v6', 'm22 7-8.5 8.5-5-5L2 17')),
      icon('interest', MONEY, { uk: 'Відсотки', en: 'Interest', ru: 'Проценты' }, p('M19 5 5 19') + c(6.5, 6.5, 2.5) + c(17.5, 17.5, 2.5)),
      icon('taxes', MONEY, { uk: 'Податки, рахунки', en: 'Taxes, bills', ru: 'Налоги, счета' }, p('M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z', 'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8', 'M12 17.5v-11')),
      icon('subscriptions', MONEY, { uk: 'Підписки', en: 'Subscriptions', ru: 'Подписки' }, p('m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3')),
      icon('insurance', MONEY, { uk: 'Страхування', en: 'Insurance', ru: 'Страхование' }, p('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z')),
      icon('transfer', MONEY, { uk: 'Перекази', en: 'Transfers', ru: 'Переводы' }, p('M8 3 4 7l4 4', 'M4 7h16', 'm16 21 4-4-4-4', 'M20 17H4')),
      icon('debt', MONEY, { uk: 'Борги', en: 'Debts', ru: 'Долги' }, p('m11 17 2 2a1 1 0 1 0 3-3', 'm14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4', 'm21 3 1 11h-2', 'M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3', 'M3 4h8')),
    ],
  },
  {
    label: { uk: 'Інше', en: 'Other', ru: 'Другое' },
    icons: [
      icon('charity', OTHER, { uk: 'Благодійність', en: 'Charity', ru: 'Благотворительность' }, p('M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z')),
      icon('work', OTHER, { uk: 'Робота, бізнес', en: 'Work, business', ru: 'Работа, бизнес' }, rect(2, 7, 20, 14, 2) + p('M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16', 'M2 13h20')),
      icon('other', OTHER, { uk: 'Інше', en: 'Other', ru: 'Другое' }, c(12, 12, 10) + p('M17 12h.01', 'M12 12h.01', 'M7 12h.01')),
    ],
  },
];

export const CATEGORY_ICONS: CategoryIcon[] = CATEGORY_ICON_GROUPS.flatMap((g) => g.icons);

const BY_ID = new Map(CATEGORY_ICONS.map((i) => [i.id, i]));
const isColor = (k: string): k is ColorKey => k in ICON_COLORS;

/** 'cat-<id>[@<colour>]' (what follows 'builtin:') -> the icon and its colour; null if it is not one. */
export function parseCategoryIcon(slug: string): { icon: CategoryIcon; color: ColorKey | null } | null {
  const m = /^cat-([a-z0-9]+)(?:@([a-z]+))?$/.exec(slug);
  const icon = m && BY_ID.get(m[1]);
  if (!icon) return null;
  return { icon, color: m[2] && isColor(m[2]) ? m[2] : null };
}

/** The picture reference of an icon in a colour (null: the icon's group colour, e.g. a preset category). */
export const categoryIconRef = (id: string, color: ColorKey | null) => `builtin:cat-${id}${color ? `@${color}` : ''}`;

/** The icon as a picture: the glyph in white on its colour, filling a 32×32 circle. */
export function categoryIconSvg(i: CategoryIcon, color: ColorKey | null = null): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="${ICON_COLORS[color ?? i.color]}"/>` +
    `<g transform="translate(7 7) scale(.75)" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${i.glyph}</g></svg>`
  );
}
