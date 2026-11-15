import type { Lang } from '../i18n';
import { newId } from './ops';
import type { Account, Asset, Category, Contact, Data, FormId, Service } from './types';

/**
 * Starting data written into a freshly set up spreadsheet, so the user doesn't have to
 * create the basic records by hand. Texts are written in the language chosen at setup;
 * afterwards these are ordinary records the user can edit or delete.
 */

type L = Record<Lang, string>;
const pick = (l: L, lang: Lang) => l[lang];

const ASSETS: { name: L; code: string; symbol: string; image: string; decimals: number; forms: FormId[] }[] = [
  { name: { uk: 'Гривня', en: 'Hryvnia', ru: 'Гривна' }, code: 'UAH', symbol: '₴', image: 'builtin:uah', decimals: 2, forms: ['cash', 'bank'] },
  { name: { uk: 'Долар США', en: 'US dollar', ru: 'Доллар США' }, code: 'USD', symbol: '$', image: '', decimals: 2, forms: ['cash', 'bank'] },
  { name: { uk: 'Tether', en: 'Tether', ru: 'Tether' }, code: 'USDT', symbol: '', image: 'builtin:usdt', decimals: 2, forms: ['crypto'] },
  { name: { uk: 'Tron', en: 'Tron', ru: 'Tron' }, code: 'TRX', symbol: '', image: 'builtin:trx', decimals: 6, forms: ['crypto'] },
];

const BANK: L = { uk: 'Банк', en: 'Bank', ru: 'Банк' };
const EXCHANGE: L = { uk: 'Криптобіржа', en: 'Crypto exchange', ru: 'Криптобиржа' };
const WALLET: L = { uk: 'Криптогаманець', en: 'Crypto wallet', ru: 'Криптокошелёк' };

const SERVICES: { name: L | string; kind: L; image: string; forms: FormId[] }[] = [
  { name: { uk: 'Приват24', en: 'Privat24', ru: 'Приват24' }, kind: BANK, image: 'builtin:privat24', forms: ['bank'] },
  { name: 'Monobank', kind: BANK, image: 'builtin:monobank', forms: ['bank'] },
  { name: { uk: 'Ощадбанк', en: 'Oschadbank', ru: 'Ощадбанк' }, kind: BANK, image: 'builtin:oschadbank', forms: ['bank'] },
  { name: { uk: 'Райффайзен Банк', en: 'Raiffeisen Bank', ru: 'Райффайзен Банк' }, kind: BANK, image: 'builtin:raiffeisen', forms: ['bank'] },
  { name: { uk: 'ПУМБ', en: 'PUMB', ru: 'ПУМБ' }, kind: BANK, image: 'builtin:pumb', forms: ['bank'] },
  { name: 'Binance', kind: EXCHANGE, image: 'builtin:binance', forms: ['crypto'] },
  { name: 'Bybit', kind: EXCHANGE, image: 'builtin:bybit', forms: ['crypto'] },
  { name: 'OKX', kind: EXCHANGE, image: 'builtin:okx', forms: ['crypto'] },
  { name: 'Bitget', kind: EXCHANGE, image: 'builtin:bitget', forms: ['crypto'] },
  { name: 'Trust Wallet', kind: WALLET, image: 'builtin:trustwallet', forms: ['crypto'] },
  { name: 'MetaMask', kind: WALLET, image: 'builtin:metamask', forms: ['crypto'] },
  { name: 'Tonkeeper', kind: WALLET, image: 'builtin:tonkeeper', forms: ['crypto'] },
];

// each with one of the built-in category icons ('builtin:cat-<id>'), changeable like any picture
const CATEGORIES: { name: L; icon: string; children: { name: L; icon: string }[] }[] = [
  {
    name: { uk: 'Їжа', en: 'Food', ru: 'Еда' },
    icon: 'food',
    children: [
      { name: { uk: 'Продукти', en: 'Groceries', ru: 'Продукты' }, icon: 'groceries' },
      { name: { uk: 'Фастфуд', en: 'Fast food', ru: 'Фастфуд' }, icon: 'fastfood' },
    ],
  },
  { name: { uk: 'Покупки', en: 'Shopping', ru: 'Покупки' }, icon: 'shopping', children: [] },
  { name: { uk: 'Підписки', en: 'Subscriptions', ru: 'Подписки' }, icon: 'subscriptions', children: [{ name: { uk: 'YouTube', en: 'YouTube', ru: 'YouTube' }, icon: 'movies' }] },
  {
    name: { uk: 'Подарунки', en: 'Gifts', ru: 'Подарки' },
    icon: 'gift',
    children: [{ name: { uk: 'На день народження', en: 'Birthday', ru: 'На день рождения' }, icon: 'events' }],
  },
  {
    name: { uk: 'Комуналка', en: 'Utilities', ru: 'Коммуналка' },
    icon: 'power',
    children: [
      { name: { uk: 'Оренда житла', en: 'Rent', ru: 'Аренда жилья' }, icon: 'rent' },
      { name: { uk: 'WiFi', en: 'WiFi', ru: 'WiFi' }, icon: 'internet' },
      { name: { uk: 'Телефон', en: 'Phone', ru: 'Телефон' }, icon: 'phone' },
    ],
  },
  { name: { uk: 'Бізнес', en: 'Business', ru: 'Бизнес' }, icon: 'work', children: [] },
];

const SELF: L = { uk: 'Я', en: 'Me', ru: 'Я' };
const SELF_DESC: L = { uk: 'Мій контакт', en: 'My own contact', ru: 'Мой контакт' };
const MAIN_ACCOUNT: L = { uk: 'Основний рахунок', en: 'Main account', ru: 'Основной счёт' };

export function presetData(lang: Lang): Data {
  const now = new Date().toISOString();
  const stamps = { createdAt: now, updatedAt: now };

  const assets: Asset[] = ASSETS.map((a) => ({
    id: newId(),
    name: pick(a.name, lang),
    description: '',
    code: a.code,
    symbol: a.symbol,
    image: a.image,
    decimals: a.decimals,
    forms: a.forms,
    ...stamps,
  }));

  const services: Service[] = SERVICES.map((s, i) => ({
    id: newId(),
    name: typeof s.name === 'string' ? s.name : pick(s.name, lang),
    description: pick(s.kind, lang),
    image: s.image,
    forms: s.forms,
    order: i,
    ...stamps,
  }));

  const categories: Category[] = [];
  CATEGORIES.forEach((c, i) => {
    const id = newId();
    categories.push({ id, name: pick(c.name, lang), description: '', image: `builtin:cat-${c.icon}`, parentId: '', order: i, ...stamps });
    c.children.forEach((ch, j) => {
      categories.push({ id: newId(), name: pick(ch.name, lang), description: '', image: `builtin:cat-${ch.icon}`, parentId: id, order: j, ...stamps });
    });
  });

  const self: Contact = { id: newId(), name: pick(SELF, lang), description: pick(SELF_DESC, lang), image: '', isSelf: true, accountOrder: [], ...stamps };
  const uah = assets[0];
  const account: Account = {
    id: newId(),
    name: pick(MAIN_ACCOUNT, lang),
    description: '',
    form: 'bank',
    assetIds: [uah.id],
    initialBalances: { [uah.id]: 0 },
    adjustments: [],
    requisite: '',
    contactId: self.id,
    serviceId: '',
    order: 0,
    ...stamps,
  };

  return { assets, services, contacts: [self], accounts: [account], categories, transactions: [], debts: [], templates: [], settings: [] };
}
