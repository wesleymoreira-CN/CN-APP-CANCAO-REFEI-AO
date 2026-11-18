import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { 
  User, 
  Dish, 
  WeeklyMenu, 
  MealSlot, 
  UserRole, 
  RepetitionConflict, 
  MenuType, 
  DishProductionQty, 
  DayProduction,
  SystemSpreadsheet,
  AuditLogEntry,
  ClientRampaOrder,
  FruitOrderItem 
} from '../types';
import { INITIAL_USERS, INITIAL_DISHES, generateInitialMenus, createEmptyWeeklyMenu } from '../data/mockData';
import { INITIAL_CLIENT_ORDERS } from '../data/clientOrdersData';
import { 
  isValidCancaoNovaEmail, 
  scanWeeklyRepetitions, 
  normalizeSlotItems,
  getMenuForOffset,
  ComparisonWeeksWindow,
  validateDishAddition,
  CATEGORY_LABELS
} from '../utils/validators';
import { getDishQuantityKey, getDefaultQuantityForDish } from '../utils/productionUtils';
import { 
  buildSystemSpreadsheet, 
  downloadSheetAsCsv, 
  downloadAllSheetsCsv, 
  sheetToTsv 
} from '../utils/spreadsheetEngine';
import { BlockedDishModal } from '../components/BlockedDishModal';
import {
  EXTERNAL_SHEET_URL_STORAGE_KEY,
  LAST_SYNC_STORAGE_KEY,
  APPS_SCRIPT_URL_STORAGE_KEY,
  AUTO_SYNC_APPS_SCRIPT_KEY,
  LAST_APPS_SCRIPT_SYNC_KEY,
  getInitialAppsScriptUrl,
  getInitialExternalSheetUrl,
  getLoadedExternalUsers,
  syncUsersFromExternalSheet,
  authenticateUserWithSheet,
  fetchUsersViaAppsScript,
  fetchFullDataViaAppsScript,
  pushFullSyncToAppsScript,
  pushSingleOrderToAppsScript,
  pushSingleUserToAppsScript,
  deleteOrderInAppsScript,
  parseMenuRowsFromAppsScript,
  triggerAppsScriptCleanup,
  fetchServerAppsScriptUrl,
  saveServerAppsScriptUrl,
  syncAddressBarWithScriptUrl,
} from '../services/externalDatabaseService';
import { splitExpiredOrders, getOrderRetentionInfo } from '../utils/orderRetention';

interface AppContextType {
  currentUser: User | null;
  users: User[];
  dishes: Dish[];
  menus: Record<string, WeeklyMenu>;
  menuType: MenuType;
  setMenuType: (t: MenuType) => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  // External Google Sheets Database & Apps Script
  externalSheetUrl: string;
  setExternalSheetUrl: (url: string) => void;
  syncExternalDatabase: (customUrl?: string) => Promise<{ success: boolean; message: string; count: number }>;
  isSyncingDatabase: boolean;
  lastDatabaseSync: string | null;
  appsScriptUrl: string;
  setAppsScriptUrl: (url: string) => void;
  autoSyncAppsScript: boolean;
  setAutoSyncAppsScript: (enabled: boolean) => void;
  lastAppsScriptSync: string | null;
  lastSyncError: string | null;
  pullUsersFromAppsScript: (customUrl?: string) => Promise<{ success: boolean; message: string; count: number; users?: User[] }>;
  syncAllWithAppsScript: (customUrl?: string) => Promise<{ success: boolean; message: string }>;
  toggleTheme: () => void;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  selectedMonth: number;
  setSelectedMonth: (m: number) => void;
  selectedWeek: number;
  setSelectedWeek: (w: number) => void;
  selectedDayForOptions: string | null;
  setSelectedDayForOptions: (dayKey: string | null) => void;
  currentMenu: WeeklyMenu;
  previousMenu?: WeeklyMenu;
  previousMenu2?: WeeklyMenu;
  nextMenu?: WeeklyMenu;
  nextMenu2?: WeeklyMenu;
  windowWeeks: ComparisonWeeksWindow;
  conflicts: RepetitionConflict[];
  blockedDishInfo: { dishName: string; reason?: string; conflict?: RepetitionConflict } | null;
  setBlockedDishInfo: (info: { dishName: string; reason?: string; conflict?: RepetitionConflict } | null) => void;
  checkDishAvailability: (dishName: string, category: keyof MealSlot, dayKey: string) => { allowed: boolean; reason?: string; conflict?: RepetitionConflict };
  login: (email: string, password?: string) => { success: boolean; message?: string };
  registerUser: (name: string, email: string, role: UserRole, department?: string, password?: string) => { success: boolean; message?: string };
  logout: () => void;
  switchUser: (userId: string) => void;
  addUser: (name: string, email: string, role: UserRole, department?: string) => { success: boolean; message?: string };
  removeUser: (userId: string) => void;
  clearAllUsers: () => void;
  updateUserRole: (userId: string, role: UserRole) => void;
  updateMealSlot: (dayKey: string, field: keyof MealSlot, value: string | string[]) => { success: boolean; message?: string };
  addDishToSlot: (dayKey: string, field: keyof MealSlot, dishName: string) => { success: boolean; message?: string };
  editDishInSlot: (dayKey: string, field: keyof MealSlot, dishIndex: number, newDishName: string) => { success: boolean; message?: string };
  removeDishFromSlot: (dayKey: string, field: keyof MealSlot, dishIndex: number) => void;
  updateDishQuantity: (dayKey: string, category: string, dishName: string, qty: DishProductionQty) => void;
  updateDayPax: (dayKey: string, pax: number) => void;
  autoCalculateDayQuantities: (dayKey: string, pax?: number) => void;
  autoCalculateWeekQuantities: (defaultPax?: number) => void;
  updateDayNotes: (notes: string) => void;
  setWeeklyStatus: (status: WeeklyMenu['status']) => void;
  addDish: (dish: Omit<Dish, 'id'>) => Dish;
  updateDish: (dishId: string, updatedData: Partial<Dish>) => { success: boolean; message?: string };
  removeDish: (dishId: string) => void;
  clearWeekDishes: () => void;
  resetToDefault: () => void;
  exportJSON: () => string;
  importJSON: (jsonStr: string) => boolean;
  // Real-time Spreadsheet Engine
  spreadsheet: SystemSpreadsheet;
  auditLog: AuditLogEntry[];
  logAudit: (action: string, entity: string, details: string) => void;
  exportSpreadsheetCsv: (sheetKey?: string) => void;
  copySheetToClipboard: (sheetKey: string) => Promise<boolean>;
  // Permissions & Roles
  isMaster: boolean;
  isAdmin: boolean;
  isClient: boolean;
  canEdit: boolean;
  // Client Rampa & Fruits Orders Portal
  clientOrders: ClientRampaOrder[];
  pendingOrderIds: string[];
  addClientOrder: (
    order: Omit<ClientRampaOrder, 'id' | 'orderNumber' | 'createdAt' | 'status'>,
    options?: { skipAutoPush?: boolean }
  ) => ClientRampaOrder;
  addClientOrdersBatch: (
    orders: Omit<ClientRampaOrder, 'id' | 'orderNumber' | 'createdAt' | 'status'>[],
    options?: { skipAutoPush?: boolean }
  ) => ClientRampaOrder[];
  retrySyncClientOrder: (
    orderOrId: ClientRampaOrder | string,
    customScriptUrl?: string
  ) => Promise<{ success: boolean; verified?: boolean; message?: string }>;
  updateClientOrderStatus: (orderId: string, status: ClientRampaOrder['status']) => void;
  deleteClientOrder: (orderId: string) => void;
  // Automatic 8-day order retention & purge rule
  autoPurge8Days: boolean;
  setAutoPurge8Days: (enabled: boolean) => void;
  lastAutoPurgeInfo: { count: number; protocols: string[]; ranAt: string } | null;
  runOrderRetentionPurge: (options?: { force?: boolean }) => {
    removedCount: number;
    removedOrders: ClientRampaOrder[];
  };
}

const AppContext = createContext<AppContextType | null>(null);

const STORAGE_USERS = 'cardapiopro_users_v3';
const STORAGE_DISHES = 'cardapiopro_dishes_v3';
const STORAGE_MENUS = 'cardapiopro_menus_v3';
const STORAGE_CURRENT_USER = 'cardapiopro_current_user_v3';
const STORAGE_MENU_TYPE = 'cardapiopro_menu_type_v3';
const STORAGE_THEME = 'cardapiopro_theme_v3';
const STORAGE_AUDIT = 'cardapiopro_audit_log_v3';
const STORAGE_SPREADSHEET = 'cardapiopro_spreadsheet_v3';
const STORAGE_CLIENT_ORDERS = 'cardapiopro_client_orders_v3';
const STORAGE_PENDING_ORDER_IDS = 'cardapiopro_pending_order_ids_v1';
const STORAGE_PENDING_USER_IDS = 'cardapiopro_pending_user_ids_v1';
const STORAGE_AUTO_PURGE_8_DAYS = 'cardapiopro_auto_purge_8_days_v1';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Theme state: light or dark
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THEME);
      if (saved === 'dark' || saved === 'light') return saved;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    try {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      localStorage.setItem(STORAGE_THEME, theme);
    } catch (e) {
      console.error(e);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Menu Type: 'rampa' | 'kilo'
  const [menuType, setMenuTypeState] = useState<MenuType>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_MENU_TYPE);
      return saved === 'kilo' ? 'kilo' : 'rampa';
    } catch {
      return 'rampa';
    }
  });

  const setMenuType = (t: MenuType) => {
    setMenuTypeState(t);
    try {
      localStorage.setItem(STORAGE_MENU_TYPE, t);
    } catch (e) {
      console.error(e);
    }
  };

  // Day Options Modal Selection
  const [selectedDayForOptions, setSelectedDayForOptions] = useState<string | null>(null);

  // Blocked Dish Modal Alert state
  const [blockedDishInfo, setBlockedDishInfo] = useState<{
    dishName: string;
    reason?: string;
    conflict?: RepetitionConflict;
  } | null>(null);

  // External Google Sheet & Apps Script URLs
  const [externalSheetUrl, setExternalSheetUrlState] = useState<string>(() => getInitialExternalSheetUrl());

  const [appsScriptUrl, setAppsScriptUrlState] = useState<string>(() => getInitialAppsScriptUrl());

  const [autoSyncAppsScript, setAutoSyncAppsScriptState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTO_SYNC_APPS_SCRIPT_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const [isSyncingDatabase, setIsSyncingDatabase] = useState(false);
  const [lastDatabaseSync, setLastDatabaseSync] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_SYNC_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });
  const [lastAppsScriptSync, setLastAppsScriptSync] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_APPS_SCRIPT_SYNC_KEY) || null;
    } catch {
      return null;
    }
  });
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [pendingOrderIds, setPendingOrderIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PENDING_ORDER_IDS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const pendingOrderIdsRef = React.useRef<string[]>(pendingOrderIds);
  const [pendingUserIds, setPendingUserIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PENDING_USER_IDS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const pendingUserIdsRef = React.useRef<string[]>(pendingUserIds);
  const clientOrdersRef = React.useRef<ClientRampaOrder[]>([]);
  const usersRef = React.useRef<User[]>([]);
  const lastLocalMenuEditAtRef = React.useRef<number>(0);
  const isHydratingMenusRef = React.useRef<boolean>(false);
  const isFirstMenuEffectRef = React.useRef<boolean>(true);

  const setExternalSheetUrl = (url: string) => {
    setExternalSheetUrlState(url);
    try {
      localStorage.setItem(EXTERNAL_SHEET_URL_STORAGE_KEY, url);
    } catch (e) {
      console.error(e);
    }
  };

  const setAppsScriptUrl = (url: string) => {
    const trimmed = (url || '').trim();
    setAppsScriptUrlState(trimmed);
    try {
      localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, trimmed);
    } catch (e) {
      console.error(e);
    }
    syncAddressBarWithScriptUrl(trimmed);
    if (trimmed) {
      void saveServerAppsScriptUrl(trimmed);
    }
  };

  useEffect(() => {
    if (appsScriptUrl) {
      syncAddressBarWithScriptUrl(appsScriptUrl);
      void saveServerAppsScriptUrl(appsScriptUrl);
      return;
    }
    let cancelled = false;
    void fetchServerAppsScriptUrl().then((serverUrl) => {
      if (cancelled || !serverUrl) return;
      setAppsScriptUrlState(serverUrl);
      try {
        localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, serverUrl);
      } catch {
        // ignore storage errors
      }
      syncAddressBarWithScriptUrl(serverUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [appsScriptUrl]);

  const setAutoSyncAppsScript = (enabled: boolean) => {
    setAutoSyncAppsScriptState(enabled);
    try {
      localStorage.setItem(AUTO_SYNC_APPS_SCRIPT_KEY, String(enabled));
    } catch (e) {
      console.error(e);
    }
  };

  const syncExternalDatabase = async (customUrl?: string) => {
    const urlToUse = customUrl !== undefined ? customUrl : externalSheetUrl;
    setIsSyncingDatabase(true);
    try {
      const result = await syncUsersFromExternalSheet(urlToUse);
      if (result.success && result.users.length > 0) {
        usersRef.current = result.users;
        setUsers(result.users);
        setLastSyncError(null);
        try {
          localStorage.setItem(STORAGE_USERS, JSON.stringify(result.users));
        } catch (e) {
          console.error(e);
        }
        setLastDatabaseSync(new Date().toISOString());
      } else if (!result.success) {
        setLastSyncError(result.message || 'Não foi possível sincronizar via CSV.');
      }
      return result;
    } finally {
      setIsSyncingDatabase(false);
    }
  };

  const markOrderPending = useCallback((orderId: string) => {
    setPendingOrderIds((prev) => {
      if (prev.includes(orderId)) return prev;
      const next = [...prev, orderId];
      pendingOrderIdsRef.current = next;
      try {
        localStorage.setItem(STORAGE_PENDING_ORDER_IDS, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const clearOrderPending = useCallback((orderId: string) => {
    setPendingOrderIds((prev) => {
      if (!prev.includes(orderId)) return prev;
      const next = prev.filter((id) => id !== orderId);
      pendingOrderIdsRef.current = next;
      try {
        localStorage.setItem(STORAGE_PENDING_ORDER_IDS, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const markUserPending = useCallback((userId: string) => {
    setPendingUserIds((prev) => {
      if (prev.includes(userId)) return prev;
      const next = [...prev, userId];
      pendingUserIdsRef.current = next;
      try {
        localStorage.setItem(STORAGE_PENDING_USER_IDS, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const clearUserPending = useCallback((userId: string) => {
    setPendingUserIds((prev) => {
      if (!prev.includes(userId)) return prev;
      const next = prev.filter((id) => id !== userId);
      pendingUserIdsRef.current = next;
      try {
        localStorage.setItem(STORAGE_PENDING_USER_IDS, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const retrySyncClientOrder = useCallback(
    async (
      orderOrId: ClientRampaOrder | string,
      customScriptUrl?: string
    ): Promise<{ success: boolean; verified?: boolean; message?: string }> => {
      const urlToUse = (customScriptUrl !== undefined ? customScriptUrl : appsScriptUrl).trim();
      const targetOrder =
        typeof orderOrId === 'string'
          ? clientOrdersRef.current.find((o) => o.id === orderOrId)
          : orderOrId;

      if (!targetOrder) {
        return { success: false, verified: false, message: 'Pedido não encontrado na memória local.' };
      }
      if (!urlToUse) {
        markOrderPending(targetOrder.id);
        return {
          success: false,
          verified: false,
          message: 'URL do Google Apps Script (/exec) não configurada neste aparelho.',
        };
      }

      const res = await pushSingleOrderToAppsScript(urlToUse, targetOrder);
      if (res.success) {
        clearOrderPending(targetOrder.id);
        setLastSyncError(null);
        setLastAppsScriptSync(new Date().toISOString());
      } else {
        markOrderPending(targetOrder.id);
        if (res.message) setLastSyncError(res.message);
      }
      return res;
    },
    [appsScriptUrl, clearOrderPending, markOrderPending]
  );

  const pullUsersFromAppsScript = async (customUrl?: string) => {
    const urlToUse = customUrl !== undefined ? customUrl : appsScriptUrl;
    if (!urlToUse || !urlToUse.trim()) {
      return {
        success: false,
        count: 0,
        message: 'Nenhuma URL do Apps Script configurada neste aparelho.',
      };
    }

    setIsSyncingDatabase(true);
    try {
      // Flush any locally queued new user registrations BEFORE pulling so they appear in Cadastros_Validos
      if (pendingUserIdsRef.current.length > 0) {
        const pendingUsersSnapshot = [...pendingUserIdsRef.current];
        for (const uId of pendingUsersSnapshot) {
          const usr = usersRef.current.find((u) => u.id === uId);
          if (usr) {
            const flushUserRes = await pushSingleUserToAppsScript(urlToUse, usr);
            if (flushUserRes.success) {
              clearUserPending(uId);
              setLastAppsScriptSync(new Date().toISOString());
            }
          } else {
            clearUserPending(uId);
          }
        }
      }

      // Flush any locally queued mobile orders to Google Sheets BEFORE pulling so nothing is lost
      if (pendingOrderIdsRef.current.length > 0) {
        const pendingSnapshot = [...pendingOrderIdsRef.current];
        for (const pId of pendingSnapshot) {
          const ord = clientOrdersRef.current.find((o) => o.id === pId);
          if (ord) {
            const flushRes = await pushSingleOrderToAppsScript(urlToUse, ord);
            if (flushRes.success) {
              clearOrderPending(pId);
              setLastAppsScriptSync(new Date().toISOString());
            }
          } else {
            clearOrderPending(pId);
          }
        }
      }

      const mergeUsersPreservingLocalPending = (remoteUsers: (User & { password?: string; active?: boolean })[]) => {
        const remoteEmails = new Set(remoteUsers.map((u) => u.email.toLowerCase()));
        const pendingUserSet = new Set(pendingUserIdsRef.current);
        const nowMs = Date.now();
        const preservedLocalUsers = usersRef.current.filter((u) => {
          if (remoteEmails.has(u.email.toLowerCase())) return false;
          if (pendingUserSet.has(u.id)) return true;
          const createdMs = new Date(u.createdAt || '').getTime();
          return !isNaN(createdMs) && nowMs - createdMs < 120000;
        });
        return [...remoteUsers, ...preservedLocalUsers];
      };

      const fullRes = await fetchFullDataViaAppsScript(urlToUse, clientOrdersRef.current);
      if (fullRes.success) {
        if (fullRes.users.length > 0) {
          const mergedUsersList = mergeUsersPreservingLocalPending(fullRes.users);
          usersRef.current = mergedUsersList;
          setUsers(mergedUsersList);
          try {
            localStorage.setItem(STORAGE_USERS, JSON.stringify(mergedUsersList));
          } catch (e) {
            console.error(e);
          }
        }
        const sampleOrderIds = new Set(INITIAL_CLIENT_ORDERS.map((o) => o.id));
        const pendingSet = new Set(pendingOrderIdsRef.current);
        if (fullRes.orders.length > 0) {
          setClientOrders((prev) => {
            const sheetOrderIds = new Set(fullRes.orders.map((o) => o.id));
            const nowMs = Date.now();
            const preservedLocalOnly = prev.filter((o) => {
              if (sheetOrderIds.has(o.id) || sampleOrderIds.has(o.id)) return false;
              if (pendingSet.has(o.id)) return true;
              const createdMs = new Date(o.createdAt || '').getTime();
              return !isNaN(createdMs) && nowMs - createdMs < 120000;
            });
            const merged = [...preservedLocalOnly, ...fullRes.orders];
            return autoPurge8Days ? splitExpiredOrders(merged).activeOrders : merged;
          });
        } else if (lastAppsScriptSync) {
          setClientOrders((prev) => {
            const nowMs = Date.now();
            return prev.filter((o) => {
              if (sampleOrderIds.has(o.id)) return false;
              if (pendingSet.has(o.id)) return true;
              const createdMs = new Date(o.createdAt || '').getTime();
              return !isNaN(createdMs) && nowMs - createdMs < 120000;
            });
          });
        }
        if (
          fullRes.rawMenuRows.length > 0 &&
          Date.now() - lastLocalMenuEditAtRef.current > 10000
        ) {
          isHydratingMenusRef.current = true;
          setMenus((prevMenus) => parseMenuRowsFromAppsScript(fullRes.rawMenuRows, prevMenus));
        }
        const now = new Date().toISOString();
        setLastDatabaseSync(now);
        setLastAppsScriptSync(now);
        setLastSyncError(null);
        return {
          success: true,
          users: fullRes.users,
          count: fullRes.users.length,
          sheetName: fullRes.sheetName,
          message: fullRes.message,
        };
      }

      const fallbackUsers = await fetchUsersViaAppsScript(urlToUse);
      if (fallbackUsers.success && fallbackUsers.users.length > 0) {
        const mergedFallbackUsers = mergeUsersPreservingLocalPending(fallbackUsers.users);
        usersRef.current = mergedFallbackUsers;
        setUsers(mergedFallbackUsers);
        try {
          localStorage.setItem(STORAGE_USERS, JSON.stringify(mergedFallbackUsers));
        } catch (e) {
          console.error(e);
        }
        const now = new Date().toISOString();
        setLastDatabaseSync(now);
        setLastAppsScriptSync(now);
        setLastSyncError(null);
        return {
          ...fallbackUsers,
          users: mergedFallbackUsers,
          count: mergedFallbackUsers.length,
        };
      }

      const errMsg = fullRes.message || fallbackUsers.message || 'Falha ao ler dados da planilha Google Sheets.';
      setLastSyncError(errMsg);
      return {
        ...fallbackUsers,
        message: errMsg,
      };
    } finally {
      setIsSyncingDatabase(false);
    }
  };

  const syncAllWithAppsScript = async (customUrl?: string) => {
    const urlToUse = customUrl !== undefined ? customUrl : appsScriptUrl;
    setIsSyncingDatabase(true);
    try {
      // Flush any locally queued user registrations and mobile orders first
      if (pendingUserIdsRef.current.length > 0) {
        for (const uId of [...pendingUserIdsRef.current]) {
          const usr = usersRef.current.find((u) => u.id === uId);
          if (usr) {
            const flushUserRes = await pushSingleUserToAppsScript(urlToUse, usr);
            if (flushUserRes.success) clearUserPending(uId);
          }
        }
      }
      if (pendingOrderIdsRef.current.length > 0) {
        for (const pId of [...pendingOrderIdsRef.current]) {
          const ord = clientOrdersRef.current.find((o) => o.id === pId);
          if (ord) {
            const flushRes = await pushSingleOrderToAppsScript(urlToUse, ord);
            if (flushRes.success) clearOrderPending(pId);
          }
        }
      }

      // Pull & merge remote data first so a desktop menu edit never overwrites live mobile sheet orders
      const prePull = await fetchFullDataViaAppsScript(urlToUse, clientOrdersRef.current);
      if (!prePull.success) {
        const msg = prePull.message || 'Não foi possível ler os pedidos atuais da planilha antes de enviar. Sincronização cancelada para proteger pedidos do celular.';
        setLastSyncError(msg);
        return { success: false, message: msg };
      }

      const sampleOrderIds = new Set(INITIAL_CLIENT_ORDERS.map((o) => o.id));

      let mergedUsers: (User & { password?: string; active?: boolean })[] =
        usersRef.current.length > 0 ? [...usersRef.current] : [...users];
      if (prePull.users.length > 0) {
        const userByEmail = new Map<string, User & { password?: string; active?: boolean }>();
        prePull.users.forEach((u) => {
          userByEmail.set(u.email.toLowerCase(), u);
        });
        mergedUsers.forEach((localU) => {
          const key = localU.email.toLowerCase();
          if (!userByEmail.has(key)) {
            userByEmail.set(key, localU);
          }
        });
        mergedUsers = Array.from(userByEmail.values()).map((u) =>
          u.email.toLowerCase() === 'wesley.moreira@comunidadecancaonova.com'
            ? { ...u, role: 'master' as UserRole }
            : u
        );
        usersRef.current = mergedUsers;
        setUsers(mergedUsers);
        try {
          localStorage.setItem(STORAGE_USERS, JSON.stringify(mergedUsers));
        } catch (e) {
          console.error(e);
        }
      }

      let mergedOrders = clientOrdersRef.current;
      if (prePull.orders.length > 0) {
        const remoteIds = new Set(prePull.orders.map((o) => o.id));
        const localExtras = clientOrdersRef.current.filter(
          (o) => !remoteIds.has(o.id) && !sampleOrderIds.has(o.id)
        );
        mergedOrders = [...localExtras, ...prePull.orders];
      }
      if (autoPurge8Days) {
        mergedOrders = splitExpiredOrders(mergedOrders).activeOrders;
      }
      setClientOrders(mergedOrders);

      const mergedSpreadsheet = buildSystemSpreadsheet(menus, mergedUsers, dishes, auditLog, mergedOrders);
      const pushRes = await pushFullSyncToAppsScript(urlToUse, {
        users: mergedUsers,
        orders: mergedOrders,
        spreadsheet: mergedSpreadsheet,
      });
      if (!pushRes.success) {
        setLastSyncError(pushRes.message || 'Erro ao enviar dados para a planilha.');
        return pushRes;
      }

      const now = new Date().toISOString();
      setLastAppsScriptSync(now);
      setLastDatabaseSync(now);
      setLastSyncError(null);
      logAudit(
        'Sincronização Apps Script',
        'Google Sheets',
        `Dados enviados e sincronizados com a planilha "${pushRes.sheetName || 'Google Sheets'}".`
      );
      return {
        success: true,
        message: `${pushRes.message} (${mergedUsers.length} usuários e ${mergedOrders.length} pedidos sincronizados)`,
      };
    } finally {
      setIsSyncingDatabase(false);
    }
  };

  // Initial State from localStorage or external database cache
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_USERS);
      const loaded: User[] = saved ? JSON.parse(saved) : getLoadedExternalUsers();
      // Guarantee that wesley.moreira is always Master Admin
      return loaded.map((u) => {
        if (u.email.toLowerCase() === 'wesley.moreira@comunidadecancaonova.com') {
          return { ...u, role: 'master' as UserRole };
        }
        return u;
      });
    } catch {
      return getLoadedExternalUsers();
    }
  });
  if (usersRef.current.length === 0 && users.length > 0) {
    usersRef.current = users;
  }

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      // Clear any legacy persistent localStorage session so closing/reopening the app always requires login
      localStorage.removeItem(STORAGE_CURRENT_USER);
      if (sessionStorage.getItem('cardapiopro_logged_out_v3') === 'true') {
        return null;
      }
      const saved = sessionStorage.getItem(STORAGE_CURRENT_USER);
      if (saved) {
        const parsed: User = JSON.parse(saved);
        if (parsed.email.toLowerCase() === 'wesley.moreira@comunidadecancaonova.com') {
          parsed.role = 'master';
        }
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });

  // User Permission Flags - Master and Admin have 100% full edit access to everything
  const isMaster = Boolean(
    currentUser?.role === 'master' ||
    (currentUser?.email && currentUser.email.toLowerCase() === 'wesley.moreira@comunidadecancaonova.com')
  );
  const isAdmin = Boolean(isMaster || currentUser?.role === 'admin');
  const isClient = Boolean(currentUser?.role === 'cliente');
  const canEdit = Boolean(isMaster || isAdmin);

  // 8-day automatic order retention toggle (default ON: ex. 08/10 -> purged automatically on 15/10)
  const [autoPurge8Days, setAutoPurge8DaysState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_AUTO_PURGE_8_DAYS);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const setAutoPurge8Days = (enabled: boolean) => {
    setAutoPurge8DaysState(enabled);
    try {
      localStorage.setItem(STORAGE_AUTO_PURGE_8_DAYS, String(enabled));
    } catch (e) {
      console.error(e);
    }
  };

  const initialPurgedOrdersRef = React.useRef<ClientRampaOrder[]>([]);
  const [lastAutoPurgeInfo, setLastAutoPurgeInfo] = useState<{
    count: number;
    protocols: string[];
    ranAt: string;
  } | null>(null);

  // Client Rampa & Fruit Orders state (auto-purging expired orders on init if enabled)
  const [clientOrders, setClientOrders] = useState<ClientRampaOrder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_CLIENT_ORDERS);
      const parsed: ClientRampaOrder[] = saved ? JSON.parse(saved) : INITIAL_CLIENT_ORDERS;
      const autoEnabled = localStorage.getItem(STORAGE_AUTO_PURGE_8_DAYS) !== 'false';
      if (autoEnabled) {
        const { activeOrders, expiredOrders } = splitExpiredOrders(parsed);
        if (expiredOrders.length > 0) {
          initialPurgedOrdersRef.current = expiredOrders;
          localStorage.setItem(STORAGE_CLIENT_ORDERS, JSON.stringify(activeOrders));
        }
        return activeOrders;
      }
      return parsed;
    } catch {
      return INITIAL_CLIENT_ORDERS;
    }
  });

  useEffect(() => {
    clientOrdersRef.current = clientOrders;
    try {
      localStorage.setItem(STORAGE_CLIENT_ORDERS, JSON.stringify(clientOrders));
    } catch (e) {
      console.error(e);
    }
  }, [clientOrders]);
  if (clientOrdersRef.current.length === 0 && clientOrders.length > 0) {
    clientOrdersRef.current = clientOrders;
  }

  const [dishes, setDishes] = useState<Dish[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DISHES);
      return saved ? JSON.parse(saved) : INITIAL_DISHES;
    } catch {
      return INITIAL_DISHES;
    }
  });

  const [menus, setMenus] = useState<Record<string, WeeklyMenu>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_MENUS);
      return saved ? JSON.parse(saved) : generateInitialMenus();
    } catch {
      return generateInitialMenus();
    }
  });

  // Selections
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [selectedMonth, setSelectedMonth] = useState<number>(10); // Outubro
  const [selectedWeek, setSelectedWeek] = useState<number>(2); // Semana 2

  // Persistence to localStorage
  useEffect(() => {
    usersRef.current = users;
    try {
      localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
    } catch (e) {
      console.error(e);
    }
  }, [users]);

  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_CURRENT_USER);
      if (currentUser) {
        sessionStorage.setItem(STORAGE_CURRENT_USER, JSON.stringify(currentUser));
      } else {
        sessionStorage.removeItem(STORAGE_CURRENT_USER);
      }
    } catch (e) {
      console.error(e);
    }
  }, [currentUser]);

  const latestPullFnRef = React.useRef<() => void>(() => {});
  latestPullFnRef.current = () => {
    if (appsScriptUrl) {
      void pullUsersFromAppsScript(appsScriptUrl);
    } else if (externalSheetUrl) {
      void syncExternalDatabase(externalSheetUrl);
    }
  };

  // Background refresh of external Google Sheet / Apps Script (users + orders + menus) on mount, resume, focus, reconnect, and every 30s for APK/Netlify sync
  useEffect(() => {
    if (!appsScriptUrl && !externalSheetUrl) return;

    let lastPullAt = 0;
    const runPull = (force = false) => {
      const nowMs = Date.now();
      if (!force && nowMs - lastPullAt < 5000) return;
      lastPullAt = nowMs;
      latestPullFnRef.current();
    };

    runPull(true);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runPull(false);
      }
    };
    const handleFocusOrOnline = () => runPull(false);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocusOrOnline);
    window.addEventListener('online', handleFocusOrOnline);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        runPull(true);
      }
    }, 15000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocusOrOnline);
      window.removeEventListener('online', handleFocusOrOnline);
      window.clearInterval(intervalId);
    };
  }, [appsScriptUrl, externalSheetUrl]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DISHES, JSON.stringify(dishes));
    } catch (e) {
      console.error(e);
    }
  }, [dishes]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MENUS, JSON.stringify(menus));
    } catch (e) {
      console.error(e);
    }
    if (isFirstMenuEffectRef.current) {
      isFirstMenuEffectRef.current = false;
      return;
    }
    if (isHydratingMenusRef.current) {
      isHydratingMenusRef.current = false;
      return;
    }
    if (!appsScriptUrl || !autoSyncAppsScript) return;

    lastLocalMenuEditAtRef.current = Date.now();
    const timer = window.setTimeout(() => {
      void syncAllWithAppsScript(appsScriptUrl);
    }, 2500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menus]);

  // Live Audit Trail State (synchronized with spreadsheet)
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_AUDIT);
      if (saved) return JSON.parse(saved);
      return [
        {
          id: 'log-init-1',
          timestamp: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          user: 'Sistema Automático',
          action: 'Sincronização em Tempo Real',
          entity: 'Planilha Central',
          details: 'Planilha viva conectada por detrás da interface gravando todas as ações em tempo real.',
        },
      ];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_AUDIT, JSON.stringify(auditLog));
    } catch (e) {
      console.error(e);
    }
  }, [auditLog]);

  const logAudit = useCallback((action: string, entity: string, details: string) => {
    const timestamp = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const roleName = currentUser ? (currentUser.role === 'master' ? 'Master' : currentUser.role === 'admin' ? 'Admin' : currentUser.role === 'cliente' ? 'Cliente' : 'Leitor') : 'Convidado';
    const userLabel = currentUser ? `${currentUser.name} (${roleName})` : 'Usuário / Convidado';
    const entry: AuditLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp,
      user: userLabel,
      action,
      entity,
      details,
    };
    setAuditLog((prev) => [entry, ...prev.slice(0, 199)]);
  }, [currentUser]);

  // Live System Spreadsheet backing the entire UI: "crie uma planilha por detrás desta interface e que tudo o que eu fizer vá diretamente para a planilha"
  const spreadsheet = useMemo(() => {
    return buildSystemSpreadsheet(menus, users, dishes, auditLog, clientOrders);
  }, [menus, users, dishes, auditLog, clientOrders]);

  const exportSpreadsheetCsv = (sheetKey?: string) => {
    if (!sheetKey || sheetKey === 'all') {
      downloadAllSheetsCsv(spreadsheet);
      logAudit('Download Planilha', 'Todas as Abas', 'Download da planilha completa de gestão em formato CSV estruturado.');
    } else {
      const sheet = spreadsheet.sheets[sheetKey as keyof typeof spreadsheet.sheets];
      if (sheet) {
        downloadSheetAsCsv(sheet);
        logAudit('Download Planilha', `Aba ${sheet.name}`, `Exportação da aba ${sheet.name} em formato CSV.`);
      }
    }
  };

  const copySheetToClipboard = async (sheetKey: string): Promise<boolean> => {
    const sheet = spreadsheet.sheets[sheetKey as keyof typeof spreadsheet.sheets];
    if (!sheet) return false;
    try {
      const tsv = sheetToTsv(sheet);
      await navigator.clipboard.writeText(tsv);
      logAudit('Copiar para Sheets', `Aba ${sheet.name}`, 'Dados da tabela copiados para a área de transferência para colar no Google Sheets / Excel.');
      return true;
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
      return false;
    }
  };

  // Current week menu computation & auto-creation if not in store
  const currentMenuKey = `menu-${selectedYear}-${selectedMonth}-w${selectedWeek}-${menuType}`;
  const currentMenu = useMemo(() => {
    if (menus[currentMenuKey]) {
      return menus[currentMenuKey];
    }
    const legacyKey = `menu-${selectedYear}-${selectedMonth}-w${selectedWeek}`;
    if (menuType === 'rampa' && menus[legacyKey]) {
      return { ...menus[legacyKey], menuType: 'rampa' as MenuType };
    }
    return createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
  }, [menus, currentMenuKey, selectedYear, selectedMonth, selectedWeek, menuType]);

  // 2-week window computation (W-2, W-1, W+1, W+2)
  const previousMenu = useMemo(() => {
    return getMenuForOffset(menus, selectedYear, selectedMonth, selectedWeek, -1, menuType);
  }, [menus, selectedYear, selectedMonth, selectedWeek, menuType]);

  const previousMenu2 = useMemo(() => {
    return getMenuForOffset(menus, selectedYear, selectedMonth, selectedWeek, -2, menuType);
  }, [menus, selectedYear, selectedMonth, selectedWeek, menuType]);

  const nextMenu = useMemo(() => {
    return getMenuForOffset(menus, selectedYear, selectedMonth, selectedWeek, 1, menuType);
  }, [menus, selectedYear, selectedMonth, selectedWeek, menuType]);

  const nextMenu2 = useMemo(() => {
    return getMenuForOffset(menus, selectedYear, selectedMonth, selectedWeek, 2, menuType);
  }, [menus, selectedYear, selectedMonth, selectedWeek, menuType]);

  const windowWeeks = useMemo<ComparisonWeeksWindow>(() => ({
    prevWeek2: previousMenu2,
    prevWeek1: previousMenu,
    nextWeek1: nextMenu,
    nextWeek2: nextMenu2,
  }), [previousMenu2, previousMenu, nextMenu, nextMenu2]);

  // Real-time scan of repetition conflicts across the 2-week spacing requirement
  const conflicts = useMemo(() => {
    return scanWeeklyRepetitions(currentMenu, windowWeeks);
  }, [currentMenu, windowWeeks]);

  // Dish availability validator adhering to 2-week spacing
  const checkDishAvailability = (dishName: string, category: keyof MealSlot, dayKey: string) => {
    return validateDishAddition(dishName, category, dayKey, currentMenu, menus, menuType);
  };

  // Auth & User operations: Validates domain, database existence, and password
  const login = (email: string, password?: string) => {
    const clean = email.trim().toLowerCase();
    const activeUsersList = usersRef.current.length > 0 ? usersRef.current : users;

    // 1. Mandatory Domain Validation
    if (!isValidCancaoNovaEmail(clean)) {
      return {
        success: false,
        message: 'Acesso restrito: Somente e-mails corporativos com o domínio @cancaonova.com ou @comunidadecancaonova.com são autorizados a entrar no sistema.',
      };
    }

    // 2. If password is provided, validate strictly against database credentials
    if (password !== undefined && password !== '') {
      const authRes = authenticateUserWithSheet(clean, password, activeUsersList);
      if (!authRes.success || !authRes.user) {
        return {
          success: false,
          message: authRes.message || 'Falha na autenticação.',
        };
      }

      try {
        localStorage.removeItem('cardapiopro_logged_out_v3');
        localStorage.removeItem(STORAGE_CURRENT_USER);
        sessionStorage.removeItem('cardapiopro_logged_out_v3');
        sessionStorage.setItem(STORAGE_CURRENT_USER, JSON.stringify(authRes.user));
      } catch (e) {
        console.error(e);
      }
      setCurrentUser(authRes.user);
      setUsers((prev) => prev.map((u) => (u.id === authRes.user!.id ? authRes.user! : u)));
      return { success: true };
    }

    // 3. If password was not entered, check if user exists and if password is required
    const found = activeUsersList.find((u) => u.email.toLowerCase() === clean);
    if (!found) {
      return {
        success: false,
        message: `O e-mail "${clean}" não consta na planilha do banco de dados de usuários cadastrados. Solicite ao Administrador MASTER que adicione seu e-mail e senha na planilha externa.`,
      };
    }

    if (found.active === false) {
      return {
        success: false,
        message: `O acesso para o e-mail "${clean}" está marcado como DESATIVADO na planilha de controle de usuários.`,
      };
    }

    if (found.password && found.password.trim() !== '') {
      return {
        success: false,
        message: 'Por favor, digite a senha cadastrada na planilha externa para autenticar este usuário.',
      };
    }

    const assignedRole: UserRole = clean === 'wesley.moreira@comunidadecancaonova.com' ? 'master' : found.role;
    const updatedUser: User = {
      ...found,
      role: assignedRole,
      lastLogin: new Date().toISOString(),
    };
    try {
      localStorage.removeItem('cardapiopro_logged_out_v3');
      localStorage.removeItem(STORAGE_CURRENT_USER);
      sessionStorage.removeItem('cardapiopro_logged_out_v3');
      sessionStorage.setItem(STORAGE_CURRENT_USER, JSON.stringify(updatedUser));
    } catch (e) {
      console.error(e);
    }
    setCurrentUser(updatedUser);
    setUsers((prev) => prev.map((u) => (u.id === found.id ? updatedUser : u)));
    return { success: true };
  };

  const registerUser = (name: string, email: string, role: UserRole, department?: string, password?: string) => {
    const clean = email.trim().toLowerCase();
    if (!name.trim()) {
      return {
        success: false,
        message: 'Por favor, informe seu nome completo para o cadastro.',
      };
    }
    if (!isValidCancaoNovaEmail(clean)) {
      return {
        success: false,
        message: 'Acesso restrito: Somente e-mails institucionais @cancaonova.com ou @comunidadecancaonova.com são autorizados.',
      };
    }
    if (users.some((u) => u.email.toLowerCase() === clean)) {
      return {
        success: false,
        message: 'Este e-mail já possui cadastro. Por favor, acesse a aba "Acessar Conta (Login)".',
      };
    }

    const assignedRole: UserRole = clean === 'wesley.moreira@comunidadecancaonova.com' ? 'master' : role;
    const defaultDept = assignedRole === 'cliente' 
      ? 'Cliente / Setor Solicitante' 
      : 'Restaurante & Refeitório Canção Nova';

    const newUser: User = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      email: clean,
      password: password?.trim() || '123',
      active: true,
      role: assignedRole,
      department: department?.trim() || defaultDept,
      source: 'local',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    };

    try {
      localStorage.removeItem('cardapiopro_logged_out_v3');
      localStorage.removeItem(STORAGE_CURRENT_USER);
      sessionStorage.removeItem('cardapiopro_logged_out_v3');
      sessionStorage.setItem(STORAGE_CURRENT_USER, JSON.stringify(newUser));
    } catch (e) {
      console.error(e);
    }
    setUsers((prev) => {
      const next = [...prev, newUser];
      usersRef.current = next;
      try {
        localStorage.setItem(STORAGE_USERS, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
    setCurrentUser(newUser);
    logAudit(
      'Cadastro Válido',
      'Cadastros_Validos',
      `Novo usuário "${newUser.name}" (${newUser.email}) validado e registrado na planilha de Cadastros Válidos.`
    );
    markUserPending(newUser.id);
    if (appsScriptUrl && autoSyncAppsScript) {
      void pushSingleUserToAppsScript(appsScriptUrl, newUser).then((res) => {
        if (res.success) {
          clearUserPending(newUser.id);
          setLastSyncError(null);
          setLastAppsScriptSync(new Date().toISOString());
        } else if (res.message) {
          setLastSyncError(res.message);
        }
      });
    }
    return { success: true };
  };

  const logout = () => {
    try {
      localStorage.setItem('cardapiopro_logged_out_v3', 'true');
      localStorage.removeItem(STORAGE_CURRENT_USER);
      sessionStorage.setItem('cardapiopro_logged_out_v3', 'true');
      sessionStorage.removeItem(STORAGE_CURRENT_USER);
    } catch (e) {
      console.error(e);
    }
    setCurrentUser(null);
  };

  const switchUser = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (user) {
      const assignedUser = user.email.toLowerCase() === 'wesley.moreira@comunidadecancaonova.com'
        ? { ...user, role: 'master' as UserRole }
        : user;
      try {
        localStorage.removeItem('cardapiopro_logged_out_v3');
        localStorage.removeItem(STORAGE_CURRENT_USER);
        sessionStorage.removeItem('cardapiopro_logged_out_v3');
        sessionStorage.setItem(STORAGE_CURRENT_USER, JSON.stringify(assignedUser));
      } catch (e) {
        console.error(e);
      }
      setCurrentUser(assignedUser);
    }
  };

  const addUser = (name: string, email: string, role: UserRole, department?: string) => {
    const clean = email.trim().toLowerCase();
    if (!isValidCancaoNovaEmail(clean)) {
      return {
        success: false,
        message: 'E-mail inválido. O usuário deve ter obrigatoriamente um e-mail com final @cancaonova.com ou @comunidadecancaonova.com.',
      };
    }

    if (users.some((u) => u.email.toLowerCase() === clean)) {
      return {
        success: false,
        message: 'Já existe um usuário cadastrado com este e-mail.',
      };
    }

    const assignedRole: UserRole = clean === 'wesley.moreira@comunidadecancaonova.com' ? 'master' : role;
    const newUser: User = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      email: clean,
      password: '123',
      active: true,
      role: assignedRole,
      department: department?.trim() || (assignedRole === 'cliente' ? 'Cliente Solicitante' : 'Restaurante & Refeitório Canção Nova'),
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    };

    setUsers((prev) => {
      const next = [...prev, newUser];
      usersRef.current = next;
      try {
        localStorage.setItem(STORAGE_USERS, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
    markUserPending(newUser.id);
    if (appsScriptUrl && autoSyncAppsScript) {
      void pushSingleUserToAppsScript(appsScriptUrl, newUser).then((res) => {
        if (res.success) {
          clearUserPending(newUser.id);
          setLastSyncError(null);
          setLastAppsScriptSync(new Date().toISOString());
        } else if (res.message) {
          setLastSyncError(res.message);
        }
      });
    }
    logAudit(
      'Cadastro de Usuário',
      'Cadastros_Validos',
      `Novo usuário "${newUser.name}" (${newUser.email}) cadastrado na planilha Cadastros_Validos como ${assignedRole === 'master' ? 'Administrador MASTER' : assignedRole === 'admin' ? 'Administrador Secundário' : assignedRole === 'cliente' ? 'Cliente' : 'Leitor'}.`
    );
    return { success: true };
  };

  const removeUser = (userId: string) => {
    const targetUser = users.find((u) => u.id === userId);
    if (targetUser?.email.toLowerCase() === 'wesley.moreira@comunidadecancaonova.com') {
      alert('Atenção: O Administrador MASTER (Wesley Moreira) é o proprietário do sistema e não pode ser excluído.');
      return;
    }

    const updated = users.filter((u) => u.id !== userId);
    setUsers(updated);
    try {
      localStorage.setItem(STORAGE_USERS, JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }

    logAudit(
      'Exclusão de Usuário',
      'Usuários & Permissões',
      `Usuário "${targetUser?.name || userId}" (${targetUser?.email || ''}) foi excluído da planilha de acessos.`
    );

    if (currentUser?.id === userId) {
      if (updated.length > 0) {
        setCurrentUser(updated[0]);
      } else {
        logout();
      }
    }
  };

  const clearAllUsers = () => {
    // Keep master admin protected even on clear all
    const masterUser = users.find((u) => u.email.toLowerCase() === 'wesley.moreira@comunidadecancaonova.com') || {
      id: 'user-1',
      name: 'Wesley Moreira',
      email: 'wesley.moreira@comunidadecancaonova.com',
      role: 'master' as UserRole,
      department: 'Coordenação Geral de Nutrição e Alimentação',
      createdAt: new Date().toISOString(),
    };

    setUsers([masterUser]);
    try {
      localStorage.setItem(STORAGE_USERS, JSON.stringify([masterUser]));
      if (currentUser?.email.toLowerCase() !== 'wesley.moreira@comunidadecancaonova.com') {
        setCurrentUser(masterUser);
      }
    } catch (e) {
      console.error(e);
    }
    logAudit(
      'Limpeza de Usuários',
      'Usuários & Permissões',
      `Usuários secundários foram limpos. Administrador MASTER (Wesley Moreira) preservado.`
    );
  };

  const updateUserRole = (userId: string, role: UserRole) => {
    const target = users.find((u) => u.id === userId);
    if (target?.email.toLowerCase() === 'wesley.moreira@comunidadecancaonova.com' && role !== 'master') {
      alert('O perfil do Administrador MASTER não pode ser rebaixado.');
      return;
    }
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role } : u))
    );
    if (currentUser?.id === userId) {
      setCurrentUser((prev) => (prev ? { ...prev, role } : null));
    }
  };

  // Client Orders Management
  const runOrderRetentionPurge = useCallback(
    (options?: { force?: boolean }) => {
      if (!autoPurge8Days && !options?.force) {
        return { removedCount: 0, removedOrders: [] as ClientRampaOrder[] };
      }

      const { activeOrders, expiredOrders } = splitExpiredOrders(clientOrders);
      if (expiredOrders.length === 0) {
        if (appsScriptUrl && options?.force) {
          void triggerAppsScriptCleanup(appsScriptUrl);
        }
        return { removedCount: 0, removedOrders: [] as ClientRampaOrder[] };
      }

      setClientOrders(activeOrders);
      setLastAutoPurgeInfo({
        count: expiredOrders.length,
        protocols: expiredOrders.map((o) => o.orderNumber),
        ranAt: new Date().toISOString(),
      });

      expiredOrders.forEach((ord) => {
        const info = getOrderRetentionInfo(ord);
        logAudit(
          'Auto-Exclusão (Regra 8 Dias)',
          'Planilha de Pedidos',
          `Pedido "${ord.orderNumber}" de ${ord.clientName} (criado em ${info.referenceDateBr}) atingiu o 8º dia (${info.expirationDateBr}) e foi apagado automaticamente.`
        );
      });

      if (appsScriptUrl && autoSyncAppsScript) {
        void triggerAppsScriptCleanup(appsScriptUrl);
      }

      return {
        removedCount: expiredOrders.length,
        removedOrders: expiredOrders,
      };
    },
    [autoPurge8Days, clientOrders, appsScriptUrl, autoSyncAppsScript, logAudit]
  );

  // Record initial startup auto-purged orders in audit log & trigger remote sheet cleanup once
  useEffect(() => {
    if (initialPurgedOrdersRef.current.length > 0) {
      const purged = initialPurgedOrdersRef.current;
      initialPurgedOrdersRef.current = [];
      setLastAutoPurgeInfo({
        count: purged.length,
        protocols: purged.map((o) => o.orderNumber),
        ranAt: new Date().toISOString(),
      });
      purged.forEach((ord) => {
        const info = getOrderRetentionInfo(ord);
        logAudit(
          'Auto-Exclusão (Regra 8 Dias)',
          'Planilha de Pedidos',
          `Pedido "${ord.orderNumber}" de ${ord.clientName} (criado em ${info.referenceDateBr}) atingiu o 8º dia (${info.expirationDateBr}) e foi apagado automaticamente ao abrir o app.`
        );
      });
      if (appsScriptUrl && autoSyncAppsScript) {
        void triggerAppsScriptCleanup(appsScriptUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic & window-focus check so crossing midnight into the 8th day auto-deletes expired orders
  useEffect(() => {
    if (!autoPurge8Days) return;
    const intervalId = window.setInterval(() => {
      runOrderRetentionPurge();
    }, 60_000);
    const onFocus = () => {
      runOrderRetentionPurge();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [autoPurge8Days, runOrderRetentionPurge]);

  const addClientOrder = (
    data: Omit<ClientRampaOrder, 'id' | 'orderNumber' | 'createdAt' | 'status'>,
    options?: { skipAutoPush?: boolean }
  ): ClientRampaOrder => {
    const baseOrders = clientOrdersRef.current;
    const maxNum = baseOrders.reduce((max, o) => {
      const m = String(o.orderNumber || '').match(/(\d+)$/);
      const n = m ? Number(m[1]) : 0;
      return n > max ? n : max;
    }, 0);
    const nextCount = Math.max(baseOrders.length + 1, maxNum + 1);
    const uniqueSuffix = Math.random().toString(36).slice(2, 6);
    const newOrder: ClientRampaOrder = {
      ...data,
      id: `order-${Date.now()}-${uniqueSuffix}`,
      orderNumber: `PED-RAMPA-${String(nextCount).padStart(3, '0')}`,
      status: 'solicitado',
      createdAt: new Date().toISOString(),
    };

    const nextOrders = [newOrder, ...baseOrders];
    clientOrdersRef.current = nextOrders;
    setClientOrders(nextOrders);
    markOrderPending(newOrder.id);

    logAudit(
      'Novo Pedido de Cardápio Rampa',
      'Área do Cliente',
      `Pedido "${newOrder.orderNumber}" criado por "${newOrder.clientName}" para ${newOrder.numberOfPeople} pessoas com ${newOrder.fruits.length} tipos de frutas.`
    );
    if (!options?.skipAutoPush && appsScriptUrl && autoSyncAppsScript) {
      void retrySyncClientOrder(newOrder);
    }
    return newOrder;
  };

  const addClientOrdersBatch = (
    ordersData: Omit<ClientRampaOrder, 'id' | 'orderNumber' | 'createdAt' | 'status'>[],
    options?: { skipAutoPush?: boolean }
  ): ClientRampaOrder[] => {
    if (!ordersData || ordersData.length === 0) return [];

    const baseOrders = clientOrdersRef.current;
    const maxNum = baseOrders.reduce((max, o) => {
      const m = String(o.orderNumber || '').match(/(\d+)$/);
      const n = m ? Number(m[1]) : 0;
      return n > max ? n : max;
    }, 0);
    let nextCount = Math.max(baseOrders.length + 1, maxNum + 1);
    const nowTs = Date.now();
    const createdIso = new Date(nowTs).toISOString();

    const createdOrders: ClientRampaOrder[] = ordersData.map((data, idx) => {
      const uniqueSuffix = Math.random().toString(36).slice(2, 6);
      const ordNum = `PED-RAMPA-${String(nextCount).padStart(3, '0')}`;
      nextCount += 1;
      return {
        ...data,
        id: `order-${nowTs}-${idx}-${uniqueSuffix}`,
        orderNumber: ordNum,
        status: 'solicitado',
        createdAt: createdIso,
      };
    });

    const nextOrders = [...createdOrders.slice().reverse(), ...baseOrders];
    clientOrdersRef.current = nextOrders;
    setClientOrders(nextOrders);
    createdOrders.forEach((ord) => markOrderPending(ord.id));

    const first = createdOrders[0];
    const last = createdOrders[createdOrders.length - 1];
    logAudit(
      'Pedido Semanal Rampa (Lote)',
      'Área do Cliente',
      `${createdOrders.length} pedidos semanais (${first.orderNumber} a ${last.orderNumber}) criados por "${first.clientName}" para "${first.departmentOrGroup}".`
    );

    if (!options?.skipAutoPush && appsScriptUrl && autoSyncAppsScript) {
      void (async () => {
        for (const ord of createdOrders) {
          await retrySyncClientOrder(ord);
        }
      })();
    }

    return createdOrders;
  };

  const updateClientOrderStatus = (orderId: string, status: ClientRampaOrder['status']) => {
    setClientOrders((prev) => {
      const updated = prev.map((o) => (o.id === orderId ? { ...o, status } : o));
      const changedOrder = updated.find((o) => o.id === orderId);
      if (changedOrder && appsScriptUrl && autoSyncAppsScript) {
        void pushSingleOrderToAppsScript(appsScriptUrl, changedOrder).then((res) => {
          if (res.success) {
            setLastSyncError(null);
            setLastAppsScriptSync(new Date().toISOString());
          } else if (res.message) {
            setLastSyncError(res.message);
          }
        });
      }
      return updated;
    });
    logAudit(
      'Status de Pedido Alterado',
      'Área do Cliente',
      `Status do pedido "${orderId}" alterado para "${status}".`
    );
  };

  const deleteClientOrder = (orderId: string) => {
    clearOrderPending(orderId);
    setClientOrders((prev) => prev.filter((o) => o.id !== orderId));
    if (appsScriptUrl && autoSyncAppsScript) {
      void deleteOrderInAppsScript(appsScriptUrl, orderId).then((res) => {
        if (res.success) {
          setLastSyncError(null);
          setLastAppsScriptSync(new Date().toISOString());
        } else if (res.message) {
          setLastSyncError(res.message);
        }
      });
    }
    logAudit(
      'Exclusão de Pedido',
      'Área do Cliente',
      `Pedido "${orderId}" excluído do sistema.`
    );
  };

  // Menu operations with support for MULTIPLE items per category and STRICT 2-week anti-repetition blocking
  const updateMealSlot = (dayKey: string, field: keyof MealSlot, value: string | string[]) => {
    if (!canEdit || !currentUser) {
      alert('Acesso negado: apenas usuários com perfil Administrador podem editar o cardápio.');
      return { success: false, message: 'Acesso negado.' };
    }

    const normalizedItems = normalizeSlotItems(value);
    const existingDay = currentMenu.days[dayKey as keyof typeof currentMenu.days];
    const currentItems = existingDay ? normalizeSlotItems(existingDay.lunch[field]) : [];

    // Strictly validate any newly added items against the 2-week rule
    for (const newItem of normalizedItems) {
      const isAlreadyInThisSlot = currentItems.some(
        (ci) => ci.trim().toLowerCase() === newItem.trim().toLowerCase()
      );
      if (!isAlreadyInThisSlot) {
        const validation = checkDishAvailability(newItem, field, dayKey);
        if (!validation.allowed) {
          setBlockedDishInfo({
            dishName: newItem,
            reason: validation.reason,
            conflict: validation.conflict,
          });
          return { success: false, message: validation.reason };
        }
      }
    }

    setMenus((prev) => {
      const existing = prev[currentMenuKey] || createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
      const targetDay = (existing.days as any)[dayKey];
      if (!targetDay) return prev;

      const updatedDay = {
        ...targetDay,
        lunch: {
          ...targetDay.lunch,
          [field]: normalizedItems,
        },
      };

      const updatedMenu: WeeklyMenu = {
        ...existing,
        menuType,
        days: {
          ...existing.days,
          [dayKey]: updatedDay,
        },
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name,
      };

      return {
        ...prev,
        [currentMenuKey]: updatedMenu,
      };
    });

    return { success: true };
  };

  // Add one additional dish to an existing slot with active blocking
  const addDishToSlot = (dayKey: string, field: keyof MealSlot, dishName: string) => {
    if (!canEdit || !currentUser) {
      return { success: false, message: 'Apenas administradores podem adicionar pratos.' };
    }
    const clean = dishName.trim();
    if (!clean) return { success: false, message: 'Nome vazio.' };

    // STRICT 2-WEEK ANTI-REPETITION CHECK
    const validation = checkDishAvailability(clean, field, dayKey);
    if (!validation.allowed) {
      setBlockedDishInfo({
        dishName: clean,
        reason: validation.reason,
        conflict: validation.conflict,
      });
      return { success: false, message: validation.reason };
    }

    setMenus((prev) => {
      const existing = prev[currentMenuKey] || createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
      const targetDay = (existing.days as any)[dayKey];
      if (!targetDay) return prev;

      const currentItems = normalizeSlotItems(targetDay.lunch[field]);
      // Avoid duplicate item in the same slot
      if (currentItems.some((it) => it.toLowerCase() === clean.toLowerCase())) {
        return prev;
      }

      const updatedDay = {
        ...targetDay,
        lunch: {
          ...targetDay.lunch,
          [field]: [...currentItems, clean],
        },
      };

      return {
        ...prev,
        [currentMenuKey]: {
          ...existing,
          menuType,
          days: {
            ...existing.days,
            [dayKey]: updatedDay,
          },
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name,
        },
      };
    });

    return { success: true };
  };

  // Edit/Rename an existing dish at a specific index in a slot
  const editDishInSlot = (
    dayKey: string,
    field: keyof MealSlot,
    dishIndex: number,
    newDishName: string
  ) => {
    if (!canEdit || !currentUser) {
      return { success: false, message: 'Apenas administradores podem editar pratos.' };
    }
    const clean = newDishName.trim();
    if (!clean) {
      return { success: false, message: 'O nome do prato não pode ser vazio.' };
    }

    const targetDay = currentMenu.days[dayKey as keyof typeof currentMenu.days];
    const currentItems = targetDay ? normalizeSlotItems(targetDay.lunch[field]) : [];
    const oldName = currentItems[dishIndex];

    if (oldName && oldName.trim().toLowerCase() !== clean.toLowerCase()) {
      const validation = checkDishAvailability(clean, field, dayKey);
      if (!validation.allowed) {
        setBlockedDishInfo({
          dishName: clean,
          reason: validation.reason,
          conflict: validation.conflict,
        });
        return { success: false, message: validation.reason };
      }
    }

    setMenus((prev) => {
      const existing = prev[currentMenuKey] || createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
      const day = (existing.days as any)[dayKey];
      if (!day) return prev;

      const items = normalizeSlotItems(day.lunch[field]);
      if (dishIndex < 0 || dishIndex >= items.length) return prev;

      const updatedItems = [...items];
      updatedItems[dishIndex] = clean;

      const updatedDay = {
        ...day,
        lunch: {
          ...day.lunch,
          [field]: updatedItems,
        },
      };

      logAudit(
        'EDITAR_PRATO_CARDAPIO',
        'Cardápio Semanal',
        `Prato alterado na ${day.dayName} (${CATEGORY_LABELS[field as keyof typeof CATEGORY_LABELS] || field}): de "${oldName || 'Item'}" para "${clean}"`
      );

      return {
        ...prev,
        [currentMenuKey]: {
          ...existing,
          menuType,
          days: {
            ...existing.days,
            [dayKey]: updatedDay,
          },
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name,
        },
      };
    });

    return { success: true };
  };

  // Remove a dish at a specific index from a slot
  const removeDishFromSlot = (dayKey: string, field: keyof MealSlot, dishIndex: number) => {
    if (!canEdit || !currentUser) return;

    setMenus((prev) => {
      const existing = prev[currentMenuKey] || createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
      const targetDay = (existing.days as any)[dayKey];
      if (!targetDay) return prev;

      const currentItems = normalizeSlotItems(targetDay.lunch[field]);
      const filtered = currentItems.filter((_, idx) => idx !== dishIndex);

      const updatedDay = {
        ...targetDay,
        lunch: {
          ...targetDay.lunch,
          [field]: filtered,
        },
      };

      return {
        ...prev,
        [currentMenuKey]: {
          ...existing,
          menuType,
          days: {
            ...existing.days,
            [dayKey]: updatedDay,
          },
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name,
        },
      };
    });
  };

  const updateDishQuantity = (
    dayKey: string,
    category: string,
    dishName: string,
    qty: DishProductionQty
  ) => {
    if (!canEdit || !currentUser) {
      alert('Acesso negado: apenas administradores podem alterar as quantidades de produção.');
      return;
    }

    const qKey = getDishQuantityKey(category, dishName);

    setMenus((prev) => {
      const existing = prev[currentMenuKey] || createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
      const dayProd = existing.production?.[dayKey] || { paxTarget: 400, quantities: {} };
      
      const updatedMenu: WeeklyMenu = {
        ...existing,
        menuType,
        production: {
          ...(existing.production || {}),
          [dayKey]: {
            ...dayProd,
            quantities: {
              ...dayProd.quantities,
              [qKey]: qty,
            },
          },
        },
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name,
      };

      return {
        ...prev,
        [currentMenuKey]: updatedMenu,
      };
    });
  };

  const updateDayPax = (dayKey: string, pax: number) => {
    if (!canEdit || !currentUser) {
      alert('Acesso negado: apenas administradores podem alterar o número de comensais.');
      return;
    }

    setMenus((prev) => {
      const existing = prev[currentMenuKey] || createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
      const dayProd = existing.production?.[dayKey] || { paxTarget: pax, quantities: {} };

      const updatedMenu: WeeklyMenu = {
        ...existing,
        menuType,
        production: {
          ...(existing.production || {}),
          [dayKey]: {
            ...dayProd,
            paxTarget: pax,
          },
        },
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name,
      };

      return {
        ...prev,
        [currentMenuKey]: updatedMenu,
      };
    });
  };

  const autoCalculateDayQuantities = (dayKey: string, pax?: number) => {
    if (!canEdit || !currentUser) {
      alert('Acesso negado: apenas administradores podem recalcular quantidades.');
      return;
    }

    setMenus((prev) => {
      const existing = prev[currentMenuKey] || createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
      const day = existing.days[dayKey as keyof typeof existing.days];
      if (!day) return prev;

      const targetPax = pax || existing.production?.[dayKey]?.paxTarget || 400;
      const newQuantities: Record<string, DishProductionQty> = {};

      const categories = Object.keys(day.lunch) as (keyof MealSlot)[];
      categories.forEach((catKey) => {
        const rawItems = day.lunch[catKey];
        const items = normalizeSlotItems(rawItems);
        items.forEach((dish) => {
          const qKey = getDishQuantityKey(catKey, dish);
          newQuantities[qKey] = getDefaultQuantityForDish(catKey, dish, targetPax, items.length);
        });
      });

      const updatedMenu: WeeklyMenu = {
        ...existing,
        menuType,
        production: {
          ...(existing.production || {}),
          [dayKey]: {
            paxTarget: targetPax,
            quantities: newQuantities,
          },
        },
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name,
      };

      return {
        ...prev,
        [currentMenuKey]: updatedMenu,
      };
    });
  };

  const autoCalculateWeekQuantities = (defaultPax: number = 400) => {
    if (!canEdit || !currentUser) {
      alert('Acesso negado: apenas administradores podem recalcular quantidades.');
      return;
    }

    const dayKeys = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'] as const;

    setMenus((prev) => {
      const existing = prev[currentMenuKey] || createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
      const newProduction: Record<string, DayProduction> = {};

      dayKeys.forEach((dKey) => {
        const day = existing.days[dKey];
        const targetPax = (dKey === 'sab' || dKey === 'dom') ? Math.round(defaultPax * 0.6) : defaultPax;
        const newQuantities: Record<string, DishProductionQty> = {};

        if (day) {
          const categories = Object.keys(day.lunch) as (keyof MealSlot)[];
          categories.forEach((catKey) => {
            const rawItems = day.lunch[catKey];
            const items = normalizeSlotItems(rawItems);
            items.forEach((dish) => {
              const qKey = getDishQuantityKey(catKey, dish);
              newQuantities[qKey] = getDefaultQuantityForDish(catKey, dish, targetPax, items.length);
            });
          });
        }

        newProduction[dKey] = {
          paxTarget: targetPax,
          quantities: newQuantities,
        };
      });

      const updatedMenu: WeeklyMenu = {
        ...existing,
        menuType,
        production: newProduction,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name,
      };

      return {
        ...prev,
        [currentMenuKey]: updatedMenu,
      };
    });
  };

  const updateDayNotes = (notes: string) => {
    if (!canEdit || !currentUser) return;
    setMenus((prev) => {
      const existing = prev[currentMenuKey] || createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
      return {
        ...prev,
        [currentMenuKey]: {
          ...existing,
          notes,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name,
        },
      };
    });
  };

  const setWeeklyStatus = (status: WeeklyMenu['status']) => {
    if (!canEdit || !currentUser) return;
    setMenus((prev) => {
      const existing = prev[currentMenuKey] || createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
      return {
        ...prev,
        [currentMenuKey]: {
          ...existing,
          status,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name,
        },
      };
    });
  };

  const clearWeekDishes = () => {
    if (!canEdit || !currentUser) return;
    const fresh = createEmptyWeeklyMenu(selectedYear, selectedMonth, selectedWeek, menuType);
    fresh.updatedBy = currentUser.name;
    setMenus((prev) => ({
      ...prev,
      [currentMenuKey]: fresh,
    }));
  };

  const addDish = (dishData: Omit<Dish, 'id'>) => {
    const newDish: Dish = {
      ...dishData,
      id: `dish-${Date.now()}`,
    };
    setDishes((prev) => [newDish, ...prev]);
    return newDish;
  };

  const updateDish = (dishId: string, updatedData: Partial<Dish>) => {
    if (!canEdit || !currentUser) {
      return { success: false, message: 'Apenas administradores podem alterar pratos no catálogo.' };
    }

    const cleanName = updatedData.name ? updatedData.name.trim() : undefined;
    if (cleanName === '') {
      return { success: false, message: 'O nome do prato não pode ficar vazio.' };
    }

    setDishes((prev) => {
      const oldDish = prev.find((d) => d.id === dishId);
      const updated = prev.map((d) => {
        if (d.id === dishId) {
          return {
            ...d,
            ...updatedData,
            name: cleanName || d.name,
          };
        }
        return d;
      });

      if (oldDish && cleanName && oldDish.name !== cleanName) {
        logAudit(
          'EDITAR_PRATO_BANCO',
          'Banco de Pratos',
          `Prato alterado de "${oldDish.name}" para "${cleanName}" (${CATEGORY_LABELS[oldDish.category as keyof typeof CATEGORY_LABELS] || oldDish.category})`
        );
      } else if (oldDish) {
        logAudit(
          'EDITAR_PRATO_BANCO',
          'Banco de Pratos',
          `Informações do prato "${oldDish.name}" atualizadas.`
        );
      }

      return updated;
    });

    return { success: true };
  };

  const removeDish = (dishId: string) => {
    setDishes((prev) => prev.filter((d) => d.id !== dishId));
  };

  const resetToDefault = () => {
    setUsers(INITIAL_USERS);
    setCurrentUser(INITIAL_USERS[0]);
    setDishes(INITIAL_DISHES);
    const initialMenus = generateInitialMenus();
    setMenus(initialMenus);
    localStorage.removeItem(STORAGE_USERS);
    localStorage.removeItem(STORAGE_DISHES);
    localStorage.removeItem(STORAGE_MENUS);
    localStorage.removeItem(STORAGE_CURRENT_USER);
    localStorage.removeItem(STORAGE_MENU_TYPE);
  };

  const exportJSON = () => {
    return JSON.stringify({ users, dishes, menus, menuType, theme }, null, 2);
  };

  const importJSON = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      if (data.users && Array.isArray(data.users)) setUsers(data.users);
      if (data.dishes && Array.isArray(data.dishes)) setDishes(data.dishes);
      if (data.menus && typeof data.menus === 'object') setMenus(data.menus);
      if (data.menuType && (data.menuType === 'rampa' || data.menuType === 'kilo')) {
        setMenuType(data.menuType);
      }
      if (data.theme && (data.theme === 'light' || data.theme === 'dark')) {
        setTheme(data.theme);
      }
      return true;
    } catch {
      return false;
    }
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        users,
        dishes,
        menus,
        menuType,
        setMenuType,
        theme,
        setTheme,
        toggleTheme,
        selectedYear,
        setSelectedYear,
        selectedMonth,
        setSelectedMonth,
        selectedWeek,
        setSelectedWeek,
        selectedDayForOptions,
        setSelectedDayForOptions,
        currentMenu,
        previousMenu,
        previousMenu2,
        nextMenu,
        nextMenu2,
        windowWeeks,
        conflicts,
        blockedDishInfo,
        setBlockedDishInfo,
        checkDishAvailability,
        login,
        registerUser,
        logout,
        switchUser,
        addUser,
        removeUser,
        clearAllUsers,
        updateUserRole,
        updateMealSlot,
        addDishToSlot,
        editDishInSlot,
        removeDishFromSlot,
        updateDishQuantity,
        updateDayPax,
        autoCalculateDayQuantities,
        autoCalculateWeekQuantities,
        updateDayNotes,
        setWeeklyStatus,
        addDish,
        updateDish,
        removeDish,
        clearWeekDishes,
        resetToDefault,
        exportJSON,
        importJSON,
        spreadsheet,
        auditLog,
        logAudit,
        exportSpreadsheetCsv,
        copySheetToClipboard,
        isMaster,
        isAdmin,
        isClient,
        canEdit,
        clientOrders,
        pendingOrderIds,
        addClientOrder,
        addClientOrdersBatch,
        retrySyncClientOrder,
        updateClientOrderStatus,
        deleteClientOrder,
        autoPurge8Days,
        setAutoPurge8Days,
        lastAutoPurgeInfo,
        runOrderRetentionPurge,
        // External Google Sheets Database & Apps Script
        externalSheetUrl,
        setExternalSheetUrl,
        syncExternalDatabase,
        isSyncingDatabase,
        lastDatabaseSync,
        appsScriptUrl,
        setAppsScriptUrl,
        autoSyncAppsScript,
        setAutoSyncAppsScript,
        lastAppsScriptSync,
        lastSyncError,
        pullUsersFromAppsScript,
        syncAllWithAppsScript,
      }}
    >
      {/* Global Blocked Dish Modal Alert */}
      {blockedDishInfo && (
        <BlockedDishModal
          conflict={blockedDishInfo.conflict || null}
          dishName={blockedDishInfo.dishName}
          reason={blockedDishInfo.reason}
          onClose={() => setBlockedDishInfo(null)}
        />
      )}
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
