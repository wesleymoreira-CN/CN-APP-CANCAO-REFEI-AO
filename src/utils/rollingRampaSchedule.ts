import { DayMenu, MealSlot, WeeklyMenu } from '../types';
import { CANONICAL_FRUITS, AvailableFruit } from '../data/clientOrdersData';
import { normalizeSlotItems } from './validators';

export type WeekdayKey = 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab' | 'dom';

export const WEEKDAY_ORDER: WeekdayKey[] = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

export const WEEKDAY_META: Record<WeekdayKey, { name: string; short: string }> = {
  seg: { name: 'Segunda-feira', short: 'Seg' },
  ter: { name: 'Terça-feira', short: 'Ter' },
  qua: { name: 'Quarta-feira', short: 'Qua' },
  qui: { name: 'Quinta-feira', short: 'Qui' },
  sex: { name: 'Sexta-feira', short: 'Sex' },
  sab: { name: 'Sábado', short: 'Sáb' },
  dom: { name: 'Domingo', short: 'Dom' },
};

export const DAY_DEFAULT_FRUIT_ID: Record<WeekdayKey, string> = {
  seg: 'f-banana',
  ter: 'f-melancia',
  qua: 'f-abacaxi',
  qui: 'f-maca',
  sex: 'f-laranja',
  sab: 'f-banana',
  dom: 'f-salada-frutas',
};

export interface RollingDaySlot {
  isoDate: string; // YYYY-MM-DD
  dateStr: string; // DD/MM
  fullDateStr: string; // DD/MM/YYYY
  dayKey: WeekdayKey;
  dayName: string;
  dayShort: string;
  offsetDays: number;
  isToday: boolean;
  isNextWeekWrap: boolean;
  dayMenu: DayMenu;
  availableFruit: AvailableFruit;
  arrozDishName: string;
  feijaoDishName: string;
  principalDishName: string;
  guarnicaoDishName: string;
  saladaDishName: string;
  sobremesaDishName: string;
}

export function toLocalIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseLocalIsoDate(isoDate: string): Date {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function getWeekdayKeyFromDate(date: Date): WeekdayKey {
  const map: WeekdayKey[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  return map[date.getDay()];
}

function hasPopulatedLunch(dayMenu?: DayMenu): boolean {
  if (!dayMenu || !dayMenu.lunch) return false;
  return normalizeSlotItems(dayMenu.lunch.principal).length > 0;
}

function resolveDayMenuForDate(
  targetDate: Date,
  dayKey: WeekdayKey,
  menus: Record<string, WeeklyMenu>,
  fallbackMenu?: WeeklyMenu
): DayMenu {
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth() + 1;
  const weekNum = Math.min(4, Math.max(1, Math.ceil(targetDate.getDate() / 7)));

  const directKeys = [
    `menu-${year}-${month}-w${weekNum}-rampa`,
    `menu-${year}-${month}-w${weekNum}`,
  ];

  for (const key of directKeys) {
    const candidate = menus[key]?.days?.[dayKey];
    if (hasPopulatedLunch(candidate)) {
      return candidate;
    }
  }

  if (fallbackMenu && fallbackMenu.menuType === 'rampa') {
    const candidate = fallbackMenu.days?.[dayKey];
    if (hasPopulatedLunch(candidate)) {
      return candidate;
    }
  }

  const allRampaMenus = Object.values(menus).filter((m) => m && m.menuType === 'rampa');
  const sameWeekRampa = allRampaMenus.find(
    (m) => m.weekNumber === weekNum && hasPopulatedLunch(m.days?.[dayKey])
  );
  if (sameWeekRampa) {
    return sameWeekRampa.days[dayKey];
  }

  const anyPopulatedRampa = allRampaMenus.find((m) => hasPopulatedLunch(m.days?.[dayKey]));
  if (anyPopulatedRampa) {
    return anyPopulatedRampa.days[dayKey];
  }

  if (fallbackMenu?.days?.[dayKey]) {
    return fallbackMenu.days[dayKey];
  }

  const meta = WEEKDAY_META[dayKey];
  const emptyLunch: MealSlot = {
    principal: ['Prato Principal do Dia'],
    alternativa: ['Opção Alternativa do Dia'],
    vegetariano: ['Opção Vegetariana do Dia'],
    guarnicao: ['Guarnição do Buffet'],
    acompanhamento: ['Arroz Branco Agulhinha & Feijão Carioca'],
    salada: ['Salada Fresca da Estação'],
    sobremesa: ['Fruta Fresca da Estação'],
  };

  return {
    dayKey,
    dayName: meta.name,
    dayShort: meta.short,
    dateStr: `${String(targetDate.getDate()).padStart(2, '0')}/${String(targetDate.getMonth() + 1).padStart(2, '0')}`,
    lunch: emptyLunch,
  };
}

export function resolveAvailableFruitForDay(
  dayKey: WeekdayKey,
  sobremesaDishes: string[]
): AvailableFruit {
  const text = sobremesaDishes.join(' ').toLowerCase();

  if (text.includes('melancia')) {
    return CANONICAL_FRUITS.find((f) => f.id === 'f-melancia') || CANONICAL_FRUITS[0];
  }
  if (text.includes('abacaxi')) {
    return CANONICAL_FRUITS.find((f) => f.id === 'f-abacaxi') || CANONICAL_FRUITS[0];
  }
  if (text.includes('banana')) {
    return CANONICAL_FRUITS.find((f) => f.id === 'f-banana') || CANONICAL_FRUITS[0];
  }
  if (text.includes('maçã') || text.includes('maca')) {
    return CANONICAL_FRUITS.find((f) => f.id === 'f-maca') || CANONICAL_FRUITS[0];
  }
  if (text.includes('laranja')) {
    return CANONICAL_FRUITS.find((f) => f.id === 'f-laranja') || CANONICAL_FRUITS[0];
  }
  if (text.includes('mamão') || text.includes('mamao')) {
    return CANONICAL_FRUITS.find((f) => f.id === 'f-mamao') || CANONICAL_FRUITS[0];
  }
  if (text.includes('manga')) {
    return CANONICAL_FRUITS.find((f) => f.id === 'f-manga') || CANONICAL_FRUITS[0];
  }
  if (text.includes('uva')) {
    return CANONICAL_FRUITS.find((f) => f.id === 'f-uva') || CANONICAL_FRUITS[0];
  }
  if (text.includes('salada de fruta')) {
    return CANONICAL_FRUITS.find((f) => f.id === 'f-salada-frutas') || CANONICAL_FRUITS[0];
  }

  const targetId = DAY_DEFAULT_FRUIT_ID[dayKey] || 'f-banana';
  return CANONICAL_FRUITS.find((f) => f.id === targetId) || CANONICAL_FRUITS[0];
}

/**
 * Generates the rolling 7-day window starting from anchorIsoDate (YYYY-MM-DD).
 * Example:
 * - On Monday: Seg -> Ter -> Qua -> Qui -> Sex -> Sáb -> Dom
 * - Once Monday ends (Tuesday): Ter -> Qua -> Qui -> Sex -> Sáb -> Dom -> Próx. Segunda
 */
export function buildRolling7DaySchedule(
  anchorIsoDate: string,
  menus: Record<string, WeeklyMenu>,
  fallbackMenu?: WeeklyMenu
): RollingDaySlot[] {
  const anchor = parseLocalIsoDate(anchorIsoDate);
  const anchorMondayIndex = (anchor.getDay() + 6) % 7; // 0 = Seg ... 6 = Dom

  const slots: RollingDaySlot[] = [];

  for (let offset = 0; offset < 7; offset++) {
    const targetDate = new Date(
      anchor.getFullYear(),
      anchor.getMonth(),
      anchor.getDate() + offset,
      12,
      0,
      0
    );

    const dayKey = getWeekdayKeyFromDate(targetDate);
    const meta = WEEKDAY_META[dayKey];
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const yyyy = targetDate.getFullYear();

    const dayMenu = resolveDayMenuForDate(targetDate, dayKey, menus, fallbackMenu);

    const rawAcomp = normalizeSlotItems(dayMenu?.lunch?.acompanhamento);
    const arrozDishName =
      rawAcomp.find((d) => /arroz/i.test(d)) || rawAcomp[0] || 'Arroz Branco Agulhinha Soltinho';
    const feijaoDishName =
      rawAcomp.find((d) => /feij[aã]o/i.test(d)) || rawAcomp[1] || 'Feijão Carioca Especial';

    const principalDishes = normalizeSlotItems(dayMenu?.lunch?.principal);
    const principalDishName = principalDishes.join(' / ') || 'Picadinho Bife à Role Recheado';

    const guarnicaoDishes = normalizeSlotItems(dayMenu?.lunch?.guarnicao);
    const guarnicaoDishName = guarnicaoDishes.join(' / ') || 'Purê de Mandioquinha Perfumado';

    const saladaDishes = normalizeSlotItems(dayMenu?.lunch?.salada);
    const saladaDishName = saladaDishes.join(' / ') || 'Salada Tropical Refrescante';

    const sobremesaDishes = normalizeSlotItems(dayMenu?.lunch?.sobremesa);
    const sobremesaDishName = sobremesaDishes.join(' / ') || 'Fruta Fresca da Estação';

    const availableFruit = resolveAvailableFruitForDay(dayKey, sobremesaDishes);

    slots.push({
      isoDate: `${yyyy}-${mm}-${dd}`,
      dateStr: `${dd}/${mm}`,
      fullDateStr: `${dd}/${mm}/${yyyy}`,
      dayKey,
      dayName: meta.name,
      dayShort: meta.short,
      offsetDays: offset,
      isToday: offset === 0,
      isNextWeekWrap: anchorMondayIndex + offset >= 7,
      dayMenu,
      availableFruit,
      arrozDishName,
      feijaoDishName,
      principalDishName,
      guarnicaoDishName,
      saladaDishName,
      sobremesaDishName,
    });
  }

  return slots;
}
