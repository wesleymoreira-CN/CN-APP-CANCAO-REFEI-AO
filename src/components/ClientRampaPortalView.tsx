/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { FruitOrderItem, ClientRampaOrder, ClientMealItemRequest } from '../types';
import { normalizeSlotItems } from '../utils/validators';
import { AvailableFruit } from '../data/clientOrdersData';
import { triggerDirectPrint } from '../utils/printHelper';
import { exportElementToPdf } from '../utils/pdfHelper';
import { getOrderRetentionInfo, formatDateIso } from '../utils/orderRetention';
import { validateAppsScriptEndpoint } from '../services/externalDatabaseService';
import {
  buildRolling7DaySchedule,
  RollingDaySlot,
  toLocalIsoDate,
} from '../utils/rollingRampaSchedule';
import { 
  Soup, 
  Calendar, 
  CheckCircle2, 
  Printer, 
  FileDown, 
  Send, 
  Building2, 
  Phone, 
  User as UserIcon, 
  Sparkles, 
  Utensils, 
  FileText, 
  Layers, 
  X, 
  Trash2,
  ShieldCheck,
  Crown,
  ReceiptText,
  Info,
  FileSpreadsheet,
  Clock,
  RefreshCw,
  AlertCircle,
  Link2,
  Loader2,
  CopyCheck,
  CalendarCheck2
} from 'lucide-react';

interface ClientRampaPortalViewProps {
  onBackToMain?: () => void;
  onGoToSpreadsheet?: () => void;
}

interface MealItemPaxState {
  arroz: number;
  feijao: number;
  principal: number;
  guarnicao: number;
  salada: number;
  sobremesa: number;
}

const DEFAULT_MEAL_PAX: MealItemPaxState = {
  arroz: 5,
  feijao: 5,
  principal: 8,
  guarnicao: 8,
  salada: 5,
  sobremesa: 10,
};

function getDefaultFruitQuantity(fruit: AvailableFruit, sobremesaPax: number): number {
  if (fruit.defaultUnit === 'kg') return 2;
  return sobremesaPax > 0 ? sobremesaPax : 10;
}

export const ClientRampaPortalView: React.FC<ClientRampaPortalViewProps> = ({ 
  onBackToMain,
  onGoToSpreadsheet
}) => {
  const { 
    currentUser, 
    currentMenu, 
    menus,
    clientOrders,
    pendingOrderIds,
    addClientOrder,
    addClientOrdersBatch,
    retrySyncClientOrder,
    updateClientOrderStatus,
    deleteClientOrder,
    appsScriptUrl,
    setAppsScriptUrl,
    isSyncingDatabase,
    lastSyncError,
    pullUsersFromAppsScript
  } = useApp();

  const isClient = currentUser?.role === 'cliente';
  const isMasterOrAdmin = currentUser?.role === 'master' || currentUser?.role === 'admin';

  // Anchor date (YYYY-MM-DD local). Automatically rolls forward when the day ends!
  const [anchorDateIso, setAnchorDateIso] = useState<string>(() => toLocalIsoDate(new Date()));

  useEffect(() => {
    const checkDateRollover = () => {
      const todayIso = toLocalIsoDate(new Date());
      setAnchorDateIso((prev) => (prev !== todayIso ? todayIso : prev));
    };

    const intervalId = window.setInterval(checkDateRollover, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkDateRollover();
    };
    window.addEventListener('focus', checkDateRollover);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', checkDateRollover);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Rolling 7-day schedule starting today (e.g. Seg..Dom -> when Seg finishes, Ter..Próx Seg)
  const rollingDays = useMemo<RollingDaySlot[]>(
    () => buildRolling7DaySchedule(anchorDateIso, menus, currentMenu),
    [anchorDateIso, menus, currentMenu]
  );

  // Selected rolling slot by ISO date (defaults to Today = rollingDays[0])
  const [selectedSlotIso, setSelectedSlotIso] = useState<string>(() => toLocalIsoDate(new Date()));

  useEffect(() => {
    if (!rollingDays.some((d) => d.isoDate === selectedSlotIso) && rollingDays[0]) {
      setSelectedSlotIso(rollingDays[0].isoDate);
    }
  }, [rollingDays, selectedSlotIso]);

  // Per-ISO-date item pax map (allows configuring all 7 rolling days independently)
  const [dayPaxMap, setDayPaxMap] = useState<Record<string, MealItemPaxState>>({});

  // Per-ISO-date inclusion toggle for weekly batch submission (all 7 days included by default)
  const [includedDaysMap, setIncludedDaysMap] = useState<Record<string, boolean>>({});

  // Per-ISO-date fruit quantity/unit map
  const [dayFruitsMap, setDayFruitsMap] = useState<
    Record<string, { quantity: number; unit: AvailableFruit['defaultUnit']; notes?: string }>
  >({});

  // Visual feedback when user copies a day's quantities to the full 7-day week
  const [copiedWeekFeedback, setCopiedWeekFeedback] = useState(false);

  // Client Identification fields
  const [selectedMealShift, setSelectedMealShift] = useState<'Almoço' | 'Jantar'>('Almoço');
  const [departmentOrGroup, setDepartmentOrGroup] = useState<string>(() => {
    return currentUser?.department || 'Coordenação de Nutrição & Peregrinos Canção Nova';
  });
  const [responsibleName, setResponsibleName] = useState<string>(() => {
    return currentUser?.name || 'Wesley Moreira';
  });
  const [contactPhone, setContactPhone] = useState<string>('(12) 3186-2000');
  const [specialDietNotes, setSpecialDietNotes] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'daily' | 'weekTable' | 'myOrders'>('daily');
  const [successOrder, setSuccessOrder] = useState<ClientRampaOrder | null>(null);
  const [batchOrders, setBatchOrders] = useState<ClientRampaOrder[]>([]);
  const [batchSyncMap, setBatchSyncMap] = useState<
    Record<string, 'pending' | 'sending' | 'confirmed' | 'unverified' | 'error'>
  >({});
  const [isSendingBatch, setIsSendingBatch] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [formErrorMsg, setFormErrorMsg] = useState<string | null>(null);
  const [orderDeliveryStatus, setOrderDeliveryStatus] = useState<{
    state: 'idle' | 'sending' | 'confirmed' | 'unverified' | 'error' | 'no_url';
    message: string;
  }>({ state: 'idle', message: '' });
  const [showInlineConnect, setShowInlineConnect] = useState(false);
  const [inlineScriptInput, setInlineScriptInput] = useState(appsScriptUrl || '');
  const [inlineConnectError, setInlineConnectError] = useState<string | null>(null);
  const [retryingOrderId, setRetryingOrderId] = useState<string | null>(null);

  // Pull latest orders from Google Sheets whenever opening "Pedidos & Comprovantes"
  useEffect(() => {
    if (activeTab === 'myOrders' && appsScriptUrl) {
      void pullUsersFromAppsScript(appsScriptUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, appsScriptUrl]);

  // Print voucher ref
  const orderVoucherRef = useRef<HTMLDivElement>(null);

  const activeSlot = useMemo(
    () => rollingDays.find((d) => d.isoDate === selectedSlotIso) || rollingDays[0],
    [rollingDays, selectedSlotIso]
  );

  const selectedDayKey = activeSlot?.dayKey || 'seg';
  const activeDay = activeSlot?.dayMenu;
  const currentServiceDateFormatted = activeSlot?.fullDateStr || new Date().toLocaleDateString('pt-BR');
  const arrozDishName = activeSlot?.arrozDishName || 'Arroz Branco Agulhinha Soltinho';
  const feijaoDishName = activeSlot?.feijaoDishName || 'Feijão Carioca Especial';
  const principalDishName = activeSlot?.principalDishName || 'Picadinho Bife à Role Recheado';
  const guarnicaoDishName = activeSlot?.guarnicaoDishName || 'Purê de Mandioquinha Perfumado';
  const saladaDishName = activeSlot?.saladaDishName || 'Salada Tropical Refrescante';
  const sobremesaDishName = activeSlot?.sobremesaDishName || 'Fruta Fresca da Estação';
  const availableFruitForDay = activeSlot.availableFruit;

  const getPaxForIso = (isoDate: string): MealItemPaxState => {
    return dayPaxMap[isoDate] || DEFAULT_MEAL_PAX;
  };

  const getFruitForSlot = (
    slot: RollingDaySlot
  ): { quantity: number; unit: AvailableFruit['defaultUnit']; notes?: string } => {
    const existing = dayFruitsMap[slot.isoDate];
    if (existing) return existing;
    const pax = getPaxForIso(slot.isoDate);
    return {
      quantity: getDefaultFruitQuantity(slot.availableFruit, pax.sobremesa),
      unit: slot.availableFruit.defaultUnit,
      notes: '',
    };
  };

  const isSlotIncluded = (isoDate: string): boolean => {
    return includedDaysMap[isoDate] !== false;
  };

  const toggleSlotIncluded = (isoDate: string) => {
    setIncludedDaysMap((prev) => ({
      ...prev,
      [isoDate]: prev[isoDate] === false ? true : false,
    }));
  };

  // Current Pax & Fruit for active rolling day
  const currentPax = getPaxForIso(activeSlot.isoDate);
  const activeFruitSelection = getFruitForSlot(activeSlot);

  const updateItemPax = (field: keyof MealItemPaxState, value: number) => {
    const safeVal = Math.max(0, value);
    setDayPaxMap((prev) => ({
      ...prev,
      [activeSlot.isoDate]: {
        ...(prev[activeSlot.isoDate] || DEFAULT_MEAL_PAX),
        [field]: safeVal,
      },
    }));
  };

  // Quick preset helper
  const paxShortcuts = [0, 5, 8, 10, 15, 20, 30, 50];

  const handleDayFruitQtyChange = (delta: number) => {
    setDayFruitsMap((prev) => {
      const current = prev[activeSlot.isoDate] || getFruitForSlot(activeSlot);
      return {
        ...prev,
        [activeSlot.isoDate]: {
          ...current,
          quantity: Math.max(0, current.quantity + delta),
        },
      };
    });
  };

  const handleDayFruitSetQty = (qty: number) => {
    const safeQty = Math.max(0, qty);
    setDayFruitsMap((prev) => {
      const current = prev[activeSlot.isoDate] || getFruitForSlot(activeSlot);
      return {
        ...prev,
        [activeSlot.isoDate]: {
          ...current,
          quantity: safeQty,
        },
      };
    });
  };

  const handleDayFruitUnitChange = (unit: AvailableFruit['defaultUnit']) => {
    setDayFruitsMap((prev) => {
      const current = prev[activeSlot.isoDate] || getFruitForSlot(activeSlot);
      return {
        ...prev,
        [activeSlot.isoDate]: {
          ...current,
          unit,
        },
      };
    });
  };

  // One-tap helper: copy active day's pax & fruit quantity to all 7 rolling days
  const handleApplyCurrentDayToWeek = () => {
    const sourcePax = { ...currentPax };
    const sourceFruit = { ...activeFruitSelection };

    setDayPaxMap((prev) => {
      const next = { ...prev };
      rollingDays.forEach((slot) => {
        next[slot.isoDate] = { ...sourcePax };
      });
      return next;
    });

    setDayFruitsMap((prev) => {
      const next = { ...prev };
      rollingDays.forEach((slot) => {
        next[slot.isoDate] = {
          quantity: sourceFruit.quantity,
          unit:
            slot.availableFruit.id === activeSlot.availableFruit.id
              ? sourceFruit.unit
              : slot.availableFruit.defaultUnit === 'kg' && sourceFruit.unit !== 'kg'
              ? slot.availableFruit.defaultUnit
              : sourceFruit.unit,
          notes: sourceFruit.notes || '',
        };
      });
      return next;
    });

    setCopiedWeekFeedback(true);
    window.setTimeout(() => setCopiedWeekFeedback(false), 2800);
  };

  const includedRollingSlots = useMemo(
    () => rollingDays.filter((slot) => includedDaysMap[slot.isoDate] !== false),
    [rollingDays, includedDaysMap]
  );

  const buildOrderPayloadForSlot = (
    slot: RollingDaySlot
  ): Omit<ClientRampaOrder, 'id' | 'orderNumber' | 'createdAt' | 'status'> => {
    const pax = getPaxForIso(slot.isoDate);
    const fruitSel = getFruitForSlot(slot);

    const maxRequested = Math.max(
      pax.arroz,
      pax.feijao,
      pax.principal,
      pax.guarnicao,
      pax.salada,
      pax.sobremesa,
      1
    );

    const mealItems: ClientMealItemRequest[] = [
      {
        id: 'arroz',
        category: 'arroz',
        categoryLabel: 'Arroz',
        dishName: slot.arrozDishName,
        peopleCount: pax.arroz,
        icon: '🍚',
      },
      {
        id: 'feijao',
        category: 'feijao',
        categoryLabel: 'Feijão',
        dishName: slot.feijaoDishName,
        peopleCount: pax.feijao,
        icon: '🫘',
      },
      {
        id: 'principal',
        category: 'principal',
        categoryLabel: 'Prato Principal',
        dishName: slot.principalDishName,
        peopleCount: pax.principal,
        icon: '🥩',
      },
      {
        id: 'guarnicao',
        category: 'guarnicao',
        categoryLabel: 'Guarnição do Buffet',
        dishName: slot.guarnicaoDishName,
        peopleCount: pax.guarnicao,
        icon: '🥔',
      },
      {
        id: 'salada',
        category: 'salada',
        categoryLabel: 'Salada Fresca',
        dishName: slot.saladaDishName,
        peopleCount: pax.salada,
        icon: '🥬',
      },
      {
        id: 'sobremesa',
        category: 'sobremesa',
        categoryLabel: 'Frutas ou Sobremesa',
        dishName: `${slot.sobremesaDishName} (${slot.availableFruit.name})`,
        peopleCount: pax.sobremesa,
        icon: '🍮',
      },
    ];

    const fruitList: FruitOrderItem[] =
      fruitSel.quantity > 0
        ? [
            {
              id: slot.availableFruit.id,
              name: slot.availableFruit.name,
              icon: slot.availableFruit.icon,
              quantity: fruitSel.quantity,
              unit: fruitSel.unit,
              notes: fruitSel.notes,
            },
          ]
        : [];

    return {
      clientName: responsibleName.trim(),
      clientEmail: currentUser?.email || 'cliente@cancaonova.com',
      clientPhone: contactPhone.trim(),
      departmentOrGroup: departmentOrGroup.trim(),
      orderDate: formatDateIso(new Date()),
      serviceDate: slot.fullDateStr,
      dayName: slot.dayName,
      mealShift: selectedMealShift,
      numberOfPeople: maxRequested,
      mealItems,
      fruits: fruitList,
      specialDietNotes: specialDietNotes.trim() || undefined,
    };
  };

  const syncOrdersSequentially = async (
    ordersToSync: ClientRampaOrder[],
    customUrl?: string
  ) => {
    const urlToUse = (customUrl ?? appsScriptUrl).trim();
    if (!urlToUse) {
      setOrderDeliveryStatus({
        state: 'no_url',
        message:
          'Este aparelho ainda não está conectado à planilha Google Sheets. Cole o link /exec abaixo para enviar agora.',
      });
      return;
    }

    setIsSendingBatch(true);
    let confirmedCount = 0;
    let unverifiedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < ordersToSync.length; i++) {
      const ord = ordersToSync[i];
      setBatchSyncMap((prev) => ({ ...prev, [ord.id]: 'sending' }));
      setOrderDeliveryStatus({
        state: 'sending',
        message: `Enviando pedido da semana para o Google Sheets: dia ${i + 1} de ${ordersToSync.length} (${ord.dayName} ${ord.serviceDate})...`,
      });

      const res = await retrySyncClientOrder(ord, urlToUse);
      if (res.success && res.verified !== false) {
        confirmedCount += 1;
        setBatchSyncMap((prev) => ({ ...prev, [ord.id]: 'confirmed' }));
      } else if (res.success) {
        unverifiedCount += 1;
        setBatchSyncMap((prev) => ({ ...prev, [ord.id]: 'unverified' }));
      } else {
        errorCount += 1;
        setBatchSyncMap((prev) => ({ ...prev, [ord.id]: 'error' }));
      }
    }

    setIsSendingBatch(false);

    if (errorCount === 0 && unverifiedCount === 0) {
      setOrderDeliveryStatus({
        state: 'confirmed',
        message:
          ordersToSync.length === 1
            ? 'Pedido gravado e confirmado na planilha Google Sheets!'
            : `Todos os ${confirmedCount} dias da semana foram gravados e confirmados na planilha Google Sheets!`,
      });
    } else if (errorCount === 0) {
      setOrderDeliveryStatus({
        state: 'unverified',
        message: `${confirmedCount + unverifiedCount} de ${ordersToSync.length} dias enviados (modo compatibilidade).`,
      });
    } else {
      setOrderDeliveryStatus({
        state: 'error',
        message: `${confirmedCount} confirmados, ${errorCount} pendentes. Toque em "Reenviar Pendentes" para completar.`,
      });
    }
  };

  // Submit the entire rolling week (all checked days) at once
  const handleConfirmWeeklyOrder = async () => {
    setFormErrorMsg(null);

    if (!departmentOrGroup.trim()) {
      setFormErrorMsg('Por favor, informe o Setor, Evento ou Grupo solicitante.');
      return;
    }
    if (!responsibleName.trim()) {
      setFormErrorMsg('Por favor, informe o nome do responsável pelo pedido.');
      return;
    }
    if (includedRollingSlots.length === 0) {
      setFormErrorMsg('Marque pelo menos 1 dia da semana para enviar o pedido.');
      return;
    }

    const payloads = includedRollingSlots.map((slot) => buildOrderPayloadForSlot(slot));
    const createdOrders = addClientOrdersBatch(payloads, { skipAutoPush: true });

    const initialSyncMap: Record<string, 'pending'> = {};
    createdOrders.forEach((o) => {
      initialSyncMap[o.id] = 'pending';
    });

    setBatchOrders(createdOrders);
    setBatchSyncMap(initialSyncMap);
    setSuccessOrder(createdOrders[0] || null);
    setShowOrderModal(true);

    await syncOrdersSequentially(createdOrders);
  };

  // Submit only the currently selected single day
  const handleConfirmDailyOrder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormErrorMsg(null);

    if (!departmentOrGroup.trim()) {
      setFormErrorMsg('Por favor, informe o Setor, Evento ou Grupo solicitante.');
      return;
    }
    if (!responsibleName.trim()) {
      setFormErrorMsg('Por favor, informe o nome do responsável pelo pedido.');
      return;
    }

    const newOrder = addClientOrder(buildOrderPayloadForSlot(activeSlot), { skipAutoPush: true });

    setBatchOrders([newOrder]);
    setBatchSyncMap({ [newOrder.id]: 'pending' });
    setSuccessOrder(newOrder);
    setShowOrderModal(true);

    await syncOrdersSequentially([newOrder]);
  };

  const handleRetrySendOrder = async (order: ClientRampaOrder, customUrl?: string) => {
    setInlineConnectError(null);
    let urlToUse = (customUrl ?? appsScriptUrl).trim();
    if (customUrl !== undefined) {
      const check = validateAppsScriptEndpoint(customUrl);
      if (!check.valid) {
        setInlineConnectError(check.error || 'Cole uma URL válida terminada em /exec.');
        return;
      }
      urlToUse = check.cleanUrl;
      setAppsScriptUrl(urlToUse);
      setInlineScriptInput(urlToUse);
    }

    if (!urlToUse) {
      setOrderDeliveryStatus({
        state: 'no_url',
        message: 'Cole o link /exec do Apps Script abaixo para enviar o pedido.',
      });
      return;
    }

    setRetryingOrderId(order.id);
    setBatchSyncMap((prev) => ({ ...prev, [order.id]: 'sending' }));
    if (successOrder?.id === order.id && batchOrders.length <= 1) {
      setOrderDeliveryStatus({
        state: 'sending',
        message: 'Reenviando pedido para a planilha Google Sheets...',
      });
    }

    const res = await retrySyncClientOrder(order, urlToUse);
    setRetryingOrderId(null);

    const statusForOrder =
      res.success && res.verified !== false
        ? 'confirmed'
        : res.success
        ? 'unverified'
        : 'error';
    setBatchSyncMap((prev) => ({ ...prev, [order.id]: statusForOrder }));

    if (successOrder?.id === order.id && batchOrders.length <= 1) {
      if (res.success && res.verified !== false) {
        setOrderDeliveryStatus({
          state: 'confirmed',
          message: res.message || 'Pedido gravado e confirmado na planilha Google Sheets!',
        });
      } else if (res.success) {
        setOrderDeliveryStatus({
          state: 'unverified',
          message: res.message || 'Pedido enviado em modo compatibilidade.',
        });
      } else {
        setOrderDeliveryStatus({
          state: 'error',
          message: res.message || 'Falha ao enviar para a planilha.',
        });
      }
    }
  };

  const handleRetryBatchPending = async (customUrl?: string) => {
    setInlineConnectError(null);
    let urlToUse = (customUrl ?? appsScriptUrl).trim();
    if (customUrl !== undefined) {
      const check = validateAppsScriptEndpoint(customUrl);
      if (!check.valid) {
        setInlineConnectError(check.error || 'Cole uma URL válida terminada em /exec.');
        return;
      }
      urlToUse = check.cleanUrl;
      setAppsScriptUrl(urlToUse);
      setInlineScriptInput(urlToUse);
    }

    const pendingInBatch = batchOrders.filter(
      (o) => batchSyncMap[o.id] !== 'confirmed'
    );
    const targets = pendingInBatch.length > 0 ? pendingInBatch : batchOrders;
    await syncOrdersSequentially(targets, urlToUse);
  };

  // Filter orders: If client, show only their orders. If admin/master, show all
  const visibleOrders = useMemo(() => {
    if (isMasterOrAdmin) return clientOrders;
    return clientOrders.filter(
      (o) => o.clientEmail.toLowerCase() === (currentUser?.email || '').toLowerCase()
    );
  }, [clientOrders, currentUser, isMasterOrAdmin]);

  // Direct print without download
  const handlePrintVoucher = (order: ClientRampaOrder, keepBatch = false) => {
    if (!keepBatch) setBatchOrders([order]);
    setSuccessOrder(order);
    setTimeout(() => {
      triggerDirectPrint('portrait');
    }, 100);
  };

  // Download PDF voucher
  const handleDownloadPdfVoucher = async (order: ClientRampaOrder, keepBatch = false) => {
    if (!keepBatch) setBatchOrders([order]);
    setSuccessOrder(order);
    setIsGeneratingPdf(true);
    setTimeout(async () => {
      if (orderVoucherRef.current) {
        try {
          const fileName =
            keepBatch && batchOrders.length > 1
              ? `Comprovante_Semana_Rampa_${batchOrders[0].orderNumber}_a_${batchOrders[batchOrders.length - 1].orderNumber}.pdf`
              : `Comprovante_Pedido_${order.orderNumber}_Cancao_Nova.pdf`;
          await exportElementToPdf(orderVoucherRef.current, fileName, 'portrait');
        } catch (err) {
          console.error('PDF error:', err);
        } finally {
          setIsGeneratingPdf(false);
        }
      } else {
        setIsGeneratingPdf(false);
      }
    }, 150);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner Header */}
      <div className="bg-gradient-to-r from-amber-700 via-amber-800 to-neutral-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-white/20 backdrop-blur-md text-amber-200 flex items-center gap-1.5 shadow-xs">
                <Soup className="w-3.5 h-3.5" />
                Portal Exclusivo do Cardápio Rampa
              </span>
              {currentUser?.role === 'master' ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-neutral-950 flex items-center gap-1">
                  <Crown className="w-3 h-3 text-neutral-950" /> Admin MASTER
                </span>
              ) : currentUser?.role === 'admin' ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-400 text-neutral-950 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Admin Secundário
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-400 text-neutral-950 flex items-center gap-1">
                  <UserIcon className="w-3 h-3" /> Acesso Cliente
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight">
              Cardápio Rampa & Pedido por Número de Pessoas
            </h1>
            <p className="text-xs sm:text-sm text-amber-100/90 leading-relaxed">
              Consulte os pratos oficiais do dia no refeitório da Canção Nova e informe a quantidade por número de pessoas para Arroz, Feijão, Prato Principal, Guarnição, Salada e a Fruta disponível no dia.
            </p>
          </div>

          {/* Client / User Profile Box & Quick Table Action */}
          <div className="flex flex-col gap-2 shrink-0 sm:min-w-[240px]">
            <div className="bg-white/10 backdrop-blur-md border border-white/20 p-4 rounded-2xl flex flex-col gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-amber-500 text-white font-bold flex items-center justify-center text-sm shadow-xs">
                  {currentUser?.name?.charAt(0) || 'W'}
                </div>
                <div className="truncate">
                  <p className="text-xs font-bold leading-tight truncate">{currentUser?.name || 'Wesley Moreira'}</p>
                  <p className="text-[10px] text-amber-200 font-mono truncate">{currentUser?.email || 'wesley.moreira@comunidadecancaonova.com'}</p>
                </div>
              </div>
              <div className="pt-2 border-t border-white/15 text-[11px] flex justify-between items-center text-amber-100">
                <span>Setor:</span>
                <strong className="text-white truncate max-w-[140px]">{currentUser?.department || 'Coordenação de Nutrição'}</strong>
              </div>
            </div>

            {/* Direct button to spreadsheet table for Admin / Master */}
            {!isClient && onGoToSpreadsheet && (
              <button
                type="button"
                onClick={onGoToSpreadsheet}
                className="w-full px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all border border-emerald-400/40"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-100" />
                <span>📊 Acessar Tabela / Planilha</span>
              </button>
            )}
          </div>
        </div>

        {/* Sub-tab Navigation: ONLY shown for Admins/Master. For clients, ONLY the order-making tab is active! */}
        {!isClient ? (
          <div className="relative z-10 flex items-center gap-2 pt-6 mt-6 border-t border-white/15 overflow-x-auto">
            <button
              onClick={() => setActiveTab('daily')}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'daily'
                  ? 'bg-white text-neutral-900 shadow-md font-extrabold'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <Utensils className="w-4 h-4 text-amber-600" />
              <span>1. Fazer Pedido (Pessoas & Frutas)</span>
            </button>

            <button
              onClick={() => setActiveTab('weekTable')}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'weekTable'
                  ? 'bg-white text-neutral-900 shadow-md font-extrabold'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <Layers className="w-4 h-4 text-sky-600" />
              <span>2. Visão Geral da Semana Rampa</span>
            </button>

            <button
              onClick={() => setActiveTab('myOrders')}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'myOrders'
                  ? 'bg-white text-neutral-900 shadow-md font-extrabold'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <FileText className="w-4 h-4 text-emerald-600" />
              <span>3. Pedidos & Comprovantes ({visibleOrders.length})</span>
            </button>

            {onGoToSpreadsheet && (
              <button
                type="button"
                onClick={onGoToSpreadsheet}
                className="ml-auto px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap bg-white/15 hover:bg-white/25 text-white border border-white/20"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
                <span>Ver Planilha Completa</span>
              </button>
            )}
          </div>
        ) : (
          /* Client Header Strip: Clean single-purpose order area */
          <div className="relative z-10 pt-4 mt-4 border-t border-white/15 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-100 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Área de Pedido Aberta · Selecione o dia abaixo e monte seu pedido</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {appsScriptUrl ? (
                <button
                  type="button"
                  disabled={isSyncingDatabase}
                  onClick={() => void pullUsersFromAppsScript(appsScriptUrl)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingDatabase ? 'animate-spin' : ''}`} />
                  <span>{isSyncingDatabase ? 'Atualizando...' : 'Atualizar da Planilha'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowInlineConnect((v) => !v)}
                  className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-neutral-950 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>Conectar Planilha no Celular</span>
                </button>
              )}

              {visibleOrders.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const ord = visibleOrders[0];
                    setBatchOrders([ord]);
                    setBatchSyncMap({
                      [ord.id]: pendingOrderIds.includes(ord.id) ? 'error' : 'confirmed',
                    });
                    setSuccessOrder(ord);
                    setOrderDeliveryStatus(
                      pendingOrderIds.includes(ord.id)
                        ? { state: appsScriptUrl ? 'error' : 'no_url', message: appsScriptUrl ? 'Este pedido ainda aguarda confirmação na planilha.' : 'Conecte a planilha (/exec) abaixo para enviar este pedido.' }
                        : { state: 'confirmed', message: 'Pedido registrado na planilha Google Sheets.' }
                    );
                    setShowOrderModal(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <ReceiptText className="w-3.5 h-3.5 text-amber-300" />
                  <span>Ver Comprovante do Pedido ({visibleOrders.length} enviado{visibleOrders.length > 1 ? 's' : ''})</span>
                </button>
              )}
            </div>
          </div>
        )}

        {isClient && !appsScriptUrl && showInlineConnect && (
          <div className="relative z-10 mt-3 p-3 rounded-2xl bg-neutral-950/60 border border-amber-300/40 space-y-2 text-xs">
            <p className="font-bold text-amber-200">
              Cole a URL do Apps Script (/exec) para conectar este celular direto com a planilha:
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                value={inlineScriptInput}
                onChange={(e) => setInlineScriptInput(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="flex-1 px-3 py-2 rounded-xl bg-white text-neutral-900 font-mono text-xs"
              />
              <button
                type="button"
                onClick={async () => {
                  setInlineConnectError(null);
                  const check = validateAppsScriptEndpoint(inlineScriptInput);
                  if (!check.valid) {
                    setInlineConnectError(check.error || 'URL inválida.');
                    return;
                  }
                  setAppsScriptUrl(check.cleanUrl);
                  await pullUsersFromAppsScript(check.cleanUrl);
                  setShowInlineConnect(false);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-extrabold cursor-pointer shrink-0"
              >
                Salvar e Conectar
              </button>
            </div>
            {inlineConnectError && (
              <p className="text-rose-300 font-semibold">{inlineConnectError}</p>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: CARDÁPIO DO DIA COM CONTADORES INDIVIDUAIS POR PESSOA              */}
      {/* ========================================================================= */}
      {activeTab === 'daily' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          
          {/* Rolling 7-Day Selector Bar */}
          <div className="bg-white dark:bg-neutral-900 p-3 sm:p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Calendar className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
                  Janela Contínua de 7 Dias:
                </span>
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300">
                  {rollingDays[0]?.dayShort} {rollingDays[0]?.dateStr} → {rollingDays[6]?.dayShort} {rollingDays[6]?.dateStr}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-between sm:justify-end">
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Quando hoje acabar, entra o próximo dia equivalente.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    document
                      .getElementById('weekly-submit-section')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[11px] flex items-center gap-1 cursor-pointer shrink-0 shadow-2xs"
                >
                  <CalendarCheck2 className="w-3 h-3" />
                  <span>Enviar Semana ({includedRollingSlots.length}d) ↓</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {rollingDays.map((slot) => {
                const isSelected = activeSlot.isoDate === slot.isoDate;
                const slotIncluded = isSlotIncluded(slot.isoDate);
                const slotPax = getPaxForIso(slot.isoDate);

                return (
                  <button
                    key={slot.isoDate}
                    type="button"
                    onClick={() => setSelectedSlotIso(slot.isoDate)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center min-w-[88px] cursor-pointer relative border ${
                      isSelected
                        ? 'bg-amber-600 text-white border-amber-600 shadow-sm ring-2 ring-amber-500/40'
                        : slotIncluded
                        ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                        : 'bg-neutral-50 dark:bg-neutral-900 text-neutral-400 border-dashed border-neutral-300 dark:border-neutral-700 opacity-70'
                    }`}
                  >
                    <span className={`text-[9px] font-black uppercase tracking-wider mb-0.5 ${
                      isSelected
                        ? 'text-amber-100'
                        : slot.isToday
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : slot.isNextWeekWrap
                        ? 'text-sky-600 dark:text-sky-400'
                        : 'text-neutral-400'
                    }`}>
                      {slot.isToday ? 'HOJE' : slot.isNextWeekWrap ? 'PRÓX. SEM' : 'SEMANA'}
                    </span>
                    <span className="leading-tight">{slot.dayShort}</span>
                    <span className={`text-[10px] font-mono ${isSelected ? 'text-amber-100 font-bold' : 'text-neutral-500 dark:text-neutral-400'}`}>
                      {slot.dateStr}
                    </span>
                    <span className={`mt-1 text-[9px] font-bold px-1.5 py-0.2 rounded ${
                      !slotIncluded
                        ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-500'
                        : isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                    }`}>
                      {slotIncluded ? `${slotPax.principal} pax` : 'Ignorado'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Daily Cardápio Header & Live Summary Bar */}
          <div className="bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-amber-200/80 dark:border-amber-900/50">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="text-[11px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-400">
                    Cardápio Oficial de Rampa (Refeitório Canção Nova)
                  </span>
                  {activeSlot.isToday && (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                      HOJE
                    </span>
                  )}
                  {activeSlot.isNextWeekWrap && (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-sky-600 text-white">
                      PRÓXIMA {activeSlot.dayShort.toUpperCase()}
                    </span>
                  )}
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-neutral-900 dark:text-neutral-100">
                  {activeSlot.dayName} · {currentServiceDateFormatted}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
                <button
                  type="button"
                  onClick={() => toggleSlotIncluded(activeSlot.isoDate)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all border flex items-center gap-1.5 ${
                    isSlotIncluded(activeSlot.isoDate)
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-300 dark:border-neutral-700'
                  }`}
                >
                  <CalendarCheck2 className="w-3.5 h-3.5" />
                  <span>
                    {isSlotIncluded(activeSlot.isoDate)
                      ? 'Incluído no Pedido da Semana'
                      : 'Dia Fora do Envio Semanal'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleApplyCurrentDayToWeek}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all border flex items-center gap-1.5 ${
                    copiedWeekFeedback
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-white dark:bg-neutral-800 hover:bg-amber-100 dark:hover:bg-neutral-700 text-amber-900 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                  }`}
                  title="Copia as quantidades de pessoas e fruta deste dia para os 7 dias da semana"
                >
                  <CopyCheck className="w-3.5 h-3.5" />
                  <span>
                    {copiedWeekFeedback
                      ? '✓ Aplicado aos 7 dias!'
                      : 'Aplicar Qtds nos 7 Dias'}
                  </span>
                </button>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-300">Turno:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedMealShift('Almoço')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                      selectedMealShift === 'Almoço'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-amber-200 dark:border-amber-900'
                    }`}
                  >
                    ☀️ Almoço
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedMealShift('Jantar')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                      selectedMealShift === 'Jantar'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-amber-200 dark:border-amber-900'
                    }`}
                  >
                    🌙 Jantar
                  </button>
                </div>
              </div>
            </div>

            {/* Live Ticker of Request by People */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                Resumo das Quantidades Solicitadas ({activeSlot.dayName} · {activeSlot.dateStr}):
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-amber-200 dark:border-amber-800/80 text-xs text-neutral-800 dark:text-neutral-200 font-semibold shadow-2xs">
                  🍚 Arroz: <strong className="text-amber-700 dark:text-amber-400 font-black">{currentPax.arroz} pessoas</strong>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-amber-200 dark:border-amber-800/80 text-xs text-neutral-800 dark:text-neutral-200 font-semibold shadow-2xs">
                  🫘 Feijão: <strong className="text-amber-700 dark:text-amber-400 font-black">{currentPax.feijao} pessoas</strong>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-rose-200 dark:border-rose-800/80 text-xs text-neutral-800 dark:text-neutral-200 font-semibold shadow-2xs">
                  🥩 Prato Principal: <strong className="text-rose-700 dark:text-rose-400 font-black">{currentPax.principal} pessoas</strong>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-amber-200 dark:border-amber-800/80 text-xs text-neutral-800 dark:text-neutral-200 font-semibold shadow-2xs">
                  🥔 Guarnição: <strong className="text-amber-700 dark:text-amber-400 font-black">{currentPax.guarnicao} pessoas</strong>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-emerald-200 dark:border-emerald-800/80 text-xs text-neutral-800 dark:text-neutral-200 font-semibold shadow-2xs">
                  🥬 Salada: <strong className="text-emerald-700 dark:text-emerald-400 font-black">{currentPax.salada} pessoas</strong>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-purple-200 dark:border-purple-800/80 text-xs text-neutral-800 dark:text-neutral-200 font-semibold shadow-2xs">
                  🍮 Sobremesa / Fruta: <strong className="text-purple-700 dark:text-purple-400 font-black">{currentPax.sobremesa} pessoas</strong>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 text-xs text-amber-900 dark:text-amber-200 font-bold shadow-2xs">
                  {availableFruitForDay.icon} Fruta do Dia: <strong className="font-mono">{activeFruitSelection.quantity} {activeFruitSelection.unit}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* ===================================================================== */}
          {/* THE 5 MAIN PREPARATION CARDS + SOBREMESA                              */}
          {/* ===================================================================== */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            
            {/* 1. ARROZ */}
            <div className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 bg-white dark:bg-neutral-900 shadow-xs ${
              currentPax.arroz > 0 ? 'border-amber-500/80 ring-1 ring-amber-500/20' : 'border-neutral-200 dark:border-neutral-800'
            }`}>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🍚</span>
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 uppercase tracking-wider">
                    Arroz (Base Quente)
                  </span>
                </div>

                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-neutral-900 dark:text-neutral-100 leading-snug">
                    {arrozDishName}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                    Arroz agulhinha soltinho preparado diariamente na cozinha central Canção Nova.
                  </p>
                </div>
              </div>

              {/* Counter by People */}
              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                    Quantidade de Pessoas:
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateItemPax('arroz', currentPax.arroz - 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={currentPax.arroz}
                      onChange={(e) => updateItemPax('arroz', parseInt(e.target.value, 10) || 0)}
                      className="w-14 text-center font-mono font-black text-sm bg-neutral-50 dark:bg-neutral-800 border border-amber-300 dark:border-amber-700 rounded-lg py-1 text-neutral-900 dark:text-neutral-100"
                    />
                    <button
                      type="button"
                      onClick={() => updateItemPax('arroz', currentPax.arroz + 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Shortcuts */}
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <span className="text-[10px] text-neutral-400 mr-1">Atalhos:</span>
                  {paxShortcuts.map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => updateItemPax('arroz', num)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                        currentPax.arroz === num
                          ? 'bg-amber-600 text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 2. FEIJÃO */}
            <div className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 bg-white dark:bg-neutral-900 shadow-xs ${
              currentPax.feijao > 0 ? 'border-amber-500/80 ring-1 ring-amber-500/20' : 'border-neutral-200 dark:border-neutral-800'
            }`}>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🫘</span>
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 uppercase tracking-wider">
                    Feijão (Base Quente)
                  </span>
                </div>

                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-neutral-900 dark:text-neutral-100 leading-snug">
                    {feijaoDishName}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                    Feijão carioca com caldo artesanal temperado no alho frito e louro fresco.
                  </p>
                </div>
              </div>

              {/* Counter by People */}
              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                    Quantidade de Pessoas:
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateItemPax('feijao', currentPax.feijao - 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={currentPax.feijao}
                      onChange={(e) => updateItemPax('feijao', parseInt(e.target.value, 10) || 0)}
                      className="w-14 text-center font-mono font-black text-sm bg-neutral-50 dark:bg-neutral-800 border border-amber-300 dark:border-amber-700 rounded-lg py-1 text-neutral-900 dark:text-neutral-100"
                    />
                    <button
                      type="button"
                      onClick={() => updateItemPax('feijao', currentPax.feijao + 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Shortcuts */}
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <span className="text-[10px] text-neutral-400 mr-1">Atalhos:</span>
                  {paxShortcuts.map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => updateItemPax('feijao', num)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                        currentPax.feijao === num
                          ? 'bg-amber-600 text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. PRATO PRINCIPAL */}
            <div className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 bg-white dark:bg-neutral-900 shadow-xs ${
              currentPax.principal > 0 ? 'border-rose-500/80 ring-1 ring-rose-500/20' : 'border-neutral-200 dark:border-neutral-800'
            }`}>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🥩</span>
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 border border-rose-300 dark:border-rose-800 uppercase tracking-wider">
                    Prato Principal
                  </span>
                </div>

                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-neutral-900 dark:text-neutral-100 leading-snug">
                    {principalDishName}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                    Proteína principal servida na pista quente da rampa do refeitório.
                  </p>
                </div>
              </div>

              {/* Counter by People */}
              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                    Quantidade de Pessoas:
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateItemPax('principal', currentPax.principal - 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={currentPax.principal}
                      onChange={(e) => updateItemPax('principal', parseInt(e.target.value, 10) || 0)}
                      className="w-14 text-center font-mono font-black text-sm bg-neutral-50 dark:bg-neutral-800 border border-rose-300 dark:border-rose-700 rounded-lg py-1 text-neutral-900 dark:text-neutral-100"
                    />
                    <button
                      type="button"
                      onClick={() => updateItemPax('principal', currentPax.principal + 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Shortcuts */}
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <span className="text-[10px] text-neutral-400 mr-1">Atalhos:</span>
                  {paxShortcuts.map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => updateItemPax('principal', num)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                        currentPax.principal === num
                          ? 'bg-rose-600 text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 4. GUARNIÇÃO DO BUFFET */}
            <div className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 bg-white dark:bg-neutral-900 shadow-xs ${
              currentPax.guarnicao > 0 ? 'border-amber-500/80 ring-1 ring-amber-500/20' : 'border-neutral-200 dark:border-neutral-800'
            }`}>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🥔</span>
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 uppercase tracking-wider">
                    Guarnição do Buffet
                  </span>
                </div>

                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-neutral-900 dark:text-neutral-100 leading-snug">
                    {guarnicaoDishName}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                    Acompanhamento quente especial (purês, batatas, legumes grelhados ou farofas).
                  </p>
                </div>
              </div>

              {/* Counter by People */}
              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                    Quantidade de Pessoas:
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateItemPax('guarnicao', currentPax.guarnicao - 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={currentPax.guarnicao}
                      onChange={(e) => updateItemPax('guarnicao', parseInt(e.target.value, 10) || 0)}
                      className="w-14 text-center font-mono font-black text-sm bg-neutral-50 dark:bg-neutral-800 border border-amber-300 dark:border-amber-700 rounded-lg py-1 text-neutral-900 dark:text-neutral-100"
                    />
                    <button
                      type="button"
                      onClick={() => updateItemPax('guarnicao', currentPax.guarnicao + 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Shortcuts */}
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <span className="text-[10px] text-neutral-400 mr-1">Atalhos:</span>
                  {paxShortcuts.map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => updateItemPax('guarnicao', num)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                        currentPax.guarnicao === num
                          ? 'bg-amber-600 text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 5. SALADA DO DIA */}
            <div className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 bg-white dark:bg-neutral-900 shadow-xs ${
              currentPax.salada > 0 ? 'border-emerald-500/80 ring-1 ring-emerald-500/20' : 'border-neutral-200 dark:border-neutral-800'
            }`}>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🥬</span>
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800 uppercase tracking-wider">
                    Salada Fresca do Dia
                  </span>
                </div>

                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-neutral-900 dark:text-neutral-100 leading-snug">
                    {saladaDishName}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                    Mix de folhas verdes higienizadas e guarnições frescas de horta com molho à parte.
                  </p>
                </div>
              </div>

              {/* Counter by People */}
              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                    Quantidade de Pessoas:
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateItemPax('salada', currentPax.salada - 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={currentPax.salada}
                      onChange={(e) => updateItemPax('salada', parseInt(e.target.value, 10) || 0)}
                      className="w-14 text-center font-mono font-black text-sm bg-neutral-50 dark:bg-neutral-800 border border-emerald-300 dark:border-emerald-700 rounded-lg py-1 text-neutral-900 dark:text-neutral-100"
                    />
                    <button
                      type="button"
                      onClick={() => updateItemPax('salada', currentPax.salada + 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Shortcuts */}
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <span className="text-[10px] text-neutral-400 mr-1">Atalhos:</span>
                  {paxShortcuts.map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => updateItemPax('salada', num)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                        currentPax.salada === num
                          ? 'bg-emerald-600 text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 6. SOBREMESA / FRUTAS */}
            <div className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 bg-white dark:bg-neutral-900 shadow-xs ${
              currentPax.sobremesa > 0 ? 'border-purple-500/80 ring-1 ring-purple-500/20' : 'border-neutral-200 dark:border-neutral-800'
            }`}>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🍮</span>
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/40 text-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-800 uppercase tracking-wider">
                    Sobremesa / Frutas
                  </span>
                </div>

                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-neutral-900 dark:text-neutral-100 leading-snug">
                    {sobremesaDishName}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                    Sobremesa da rampa ou porções da fruta oficial escalada para este dia ({availableFruitForDay.name}).
                  </p>
                </div>
              </div>

              {/* Counter by People */}
              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                    Quantidade de Pessoas:
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateItemPax('sobremesa', currentPax.sobremesa - 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={currentPax.sobremesa}
                      onChange={(e) => updateItemPax('sobremesa', parseInt(e.target.value, 10) || 0)}
                      className="w-14 text-center font-mono font-black text-sm bg-neutral-50 dark:bg-neutral-800 border border-purple-300 dark:border-purple-700 rounded-lg py-1 text-neutral-900 dark:text-neutral-100"
                    />
                    <button
                      type="button"
                      onClick={() => updateItemPax('sobremesa', currentPax.sobremesa + 1)}
                      className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-black text-xs flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Shortcuts */}
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <span className="text-[10px] text-neutral-400 mr-1">Atalhos:</span>
                  {paxShortcuts.map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => updateItemPax('sobremesa', num)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                        currentPax.sobremesa === num
                          ? 'bg-purple-600 text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>

          </div>

          {/* ===================================================================== */}
          {/* SEÇÃO: APENAS A FRUTA DISPONÍVEL NO DIA (SEM OUTRAS OPÇÕES)           */}
          {/* ===================================================================== */}
          <div className="bg-white dark:bg-neutral-900 rounded-3xl border-2 border-amber-500/70 dark:border-amber-500/60 p-6 sm:p-7 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center justify-center font-bold text-2xl shadow-2xs">
                  {availableFruitForDay.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-neutral-900 dark:text-neutral-100">
                      Fruta do Dia: {availableFruitForDay.name}
                    </h3>
                    <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 uppercase tracking-wider">
                      ✓ Disponível no Dia
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Escalada exclusivamente para o atendimento de {activeSlot.dayName} ({activeSlot.dateStr}). Não há outras frutas disponíveis nesta data.
                  </p>
                </div>
              </div>

              <div className="text-xs text-neutral-500 dark:text-neutral-400 font-mono bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 rounded-xl self-start sm:self-center">
                Sugerido: <strong>{availableFruitForDay.perPersonEstimate}</strong>
              </div>
            </div>

            {/* The Single Available Fruit Card */}
            <div className="p-5 rounded-2xl border-2 border-amber-500/80 bg-amber-50/40 dark:bg-amber-950/20 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="flex items-start gap-3.5 max-w-xl">
                <span className="text-4xl shrink-0 mt-0.5">{availableFruitForDay.icon}</span>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm sm:text-base font-black text-neutral-900 dark:text-neutral-100">
                      {availableFruitForDay.name}
                    </h4>
                    <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 bg-amber-200/60 dark:bg-amber-900/60 px-2 py-0.5 rounded-md">
                      Padrão Refeitório Rampa
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    {availableFruitForDay.description}
                  </p>
                </div>
              </div>

              {/* Exact Quantity Stepper & Unit */}
              <div className="bg-white dark:bg-neutral-900 p-4 rounded-xl border border-amber-300 dark:border-amber-800 shadow-2xs space-y-2 shrink-0 md:min-w-[280px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                    Quantidade de Fruta:
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleDayFruitQtyChange(-5)}
                      className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-bold text-sm flex items-center justify-center cursor-pointer"
                    >
                      -
                    </button>

                    <input
                      type="number"
                      min={0}
                      value={activeFruitSelection.quantity}
                      onChange={(e) => handleDayFruitSetQty(parseInt(e.target.value, 10) || 0)}
                      className="w-16 text-center text-sm font-mono font-black bg-white dark:bg-neutral-800 border-2 border-amber-500 rounded-lg py-1 text-neutral-900 dark:text-neutral-100"
                    />

                    <button
                      type="button"
                      onClick={() => handleDayFruitQtyChange(5)}
                      className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 text-neutral-800 dark:text-neutral-200 font-bold text-sm flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>

                    {/* Unit */}
                    <select
                      value={activeFruitSelection.unit}
                      onChange={(e) => handleDayFruitUnitChange(e.target.value as any)}
                      className="text-xs font-bold bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg py-1 px-2 focus:outline-none cursor-pointer"
                    >
                      <option value="un">un</option>
                      <option value="kg">kg</option>
                      <option value="fatias">fatias</option>
                      <option value="porções">porções</option>
                    </select>
                  </div>
                </div>

                {/* Quick Pax-Matching Shortcut Buttons */}
                <div className="flex items-center gap-1.5 pt-1.5 border-t border-neutral-100 dark:border-neutral-800 flex-wrap">
                  <span className="text-[10px] text-neutral-400 mr-1">Ajustar:</span>
                  {[0, 5, 8, 10, 15, 20, 30, 50, 80].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleDayFruitSetQty(num)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                        activeFruitSelection.quantity === num
                          ? 'bg-amber-600 text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800/60 p-3 rounded-xl border border-neutral-200/60 dark:border-neutral-800">
              <Info className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Regra de Abastecimento:</strong> Por normas operacionais da cozinha Canção Nova, cada dia possui apenas a sua fruta oficial programada, garantindo frescor e padronização.
              </span>
            </div>
          </div>

          {/* ===================================================================== */}
          {/* SECTION: IDENTIFICAÇÃO DO GRUPO & CONFIRMAÇÃO DO PEDIDO               */}
          {/* ===================================================================== */}
          <div
            id="weekly-submit-section"
            className="bg-white dark:bg-neutral-900 rounded-3xl border border-neutral-200 dark:border-neutral-800 p-6 sm:p-8 shadow-sm space-y-6"
          >
            <div className="flex items-center gap-3 pb-4 border-b border-neutral-100 dark:border-neutral-800">
              <div className="w-10 h-10 rounded-2xl bg-amber-600 text-white flex items-center justify-center font-bold shadow-xs">
                <ReceiptText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-neutral-900 dark:text-neutral-100">
                  Dados do Solicitante & Envio do Pedido
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Confirme os dados da sua equipe para registro formal na cozinha central Canção Nova.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">
                  Setor, Evento ou Grupo
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    required
                    value={departmentOrGroup}
                    onChange={(e) => setDepartmentOrGroup(e.target.value)}
                    placeholder="Ex: Peregrinos de Fátima / Coordenação de Nutrição"
                    className="w-full pl-10 pr-3 py-2.5 text-xs bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl font-medium focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">
                  Responsável pelo Pedido
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    required
                    value={responsibleName}
                    onChange={(e) => setResponsibleName(e.target.value)}
                    placeholder="Ex: Wesley Moreira"
                    className="w-full pl-10 pr-3 py-2.5 text-xs bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl font-medium focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">
                  Telefone de Contato (WhatsApp / Ramal)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="(12) 3186-2000"
                    className="w-full pl-10 pr-3 py-2.5 text-xs bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl font-medium focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">
                Observações Especiais, Restrições ou Horário de Atendimento
              </label>
              <textarea
                rows={2}
                value={specialDietNotes}
                onChange={(e) => setSpecialDietNotes(e.target.value)}
                placeholder="Ex: Servir pontualmente às 12h15; há 2 celíacos no grupo que necessitam de separação de prato."
                className="w-full p-3 text-xs bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Weekly Rollover Summary Checklist (Send Entire Week at Once) */}
            <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/60 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarCheck2 className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                  <span className="text-xs font-extrabold text-amber-950 dark:text-amber-200">
                    Resumo da Semana Contínua ({includedRollingSlots.length} de 7 dias marcados para envio único)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const allIncluded = rollingDays.every((s) => isSlotIncluded(s.isoDate));
                    const nextMap: Record<string, boolean> = {};
                    rollingDays.forEach((s) => {
                      nextMap[s.isoDate] = !allIncluded;
                    });
                    setIncludedDaysMap(nextMap);
                  }}
                  className="text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:underline cursor-pointer self-start sm:self-center"
                >
                  {rollingDays.every((s) => isSlotIncluded(s.isoDate))
                    ? 'Desmarcar todos'
                    : 'Marcar todos os 7 dias'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
                {rollingDays.map((slot) => {
                  const checked = isSlotIncluded(slot.isoDate);
                  const pax = getPaxForIso(slot.isoDate);
                  const fr = getFruitForSlot(slot);
                  const isFocused = activeSlot.isoDate === slot.isoDate;

                  return (
                    <div
                      key={slot.isoDate}
                      className={`p-2.5 rounded-xl border text-[11px] transition-all flex flex-col justify-between gap-1.5 ${
                        checked
                          ? isFocused
                            ? 'bg-white dark:bg-neutral-900 border-amber-500 ring-1 ring-amber-500/40 shadow-xs'
                            : 'bg-white dark:bg-neutral-900 border-emerald-300 dark:border-emerald-800/70'
                          : 'bg-neutral-100/80 dark:bg-neutral-900/40 border-neutral-200 dark:border-neutral-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <label className="flex items-center gap-1.5 cursor-pointer font-extrabold text-neutral-900 dark:text-neutral-100">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSlotIncluded(slot.isoDate)}
                            className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer rounded"
                          />
                          <span>{slot.dayShort} {slot.dateStr}</span>
                        </label>
                        {slot.isToday && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            HOJE
                          </span>
                        )}
                      </div>

                      <div className="text-[10px] text-neutral-600 dark:text-neutral-400 leading-tight space-y-0.5">
                        <div className="truncate font-semibold text-neutral-800 dark:text-neutral-200">
                          Princ: <span className="font-mono">{pax.principal}</span> pax
                        </div>
                        <div className="truncate">
                          {slot.availableFruit.icon} <span className="font-mono">{fr.quantity} {fr.unit}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedSlotIso(slot.isoDate)}
                        className="text-[10px] font-bold text-amber-700 dark:text-amber-400 hover:underline text-left cursor-pointer"
                      >
                        {isFocused ? '• Editando este dia' : 'Editar dia'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {formErrorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-xs font-bold text-rose-800 dark:text-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{formErrorMsg}</span>
              </div>
            )}

            {/* Big Action Submit Buttons: Full Week at Once + Single Day */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-4 border-t border-neutral-100 dark:border-neutral-800">
              <div className="text-xs text-neutral-500 dark:text-neutral-400 max-w-md">
                {appsScriptUrl
                  ? 'Ao enviar, todos os dias selecionados da semana são gravados de uma só vez direto na planilha Google Sheets.'
                  : 'Atenção: este aparelho ainda não tem o link /exec da planilha conectado.'}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={isSendingBatch}
                  onClick={() => void handleConfirmDailyOrder()}
                  className="px-4 py-3 bg-white dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 font-bold text-xs rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5 text-amber-600" />
                  <span>Enviar Só {activeSlot.dayShort} ({activeSlot.dateStr})</span>
                </button>

                <button
                  type="button"
                  disabled={isSendingBatch}
                  onClick={() => void handleConfirmWeeklyOrder()}
                  className="px-6 py-3.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-sm rounded-2xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60"
                >
                  {isSendingBatch ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CalendarCheck2 className="w-4 h-4" />
                  )}
                  <span>
                    Enviar Pedido Total da Semana ({includedRollingSlots.length} {includedRollingSlots.length === 1 ? 'dia' : 'dias'} de uma vez)
                  </span>
                </button>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: TABELA SEMANAL COMPLETA DA RAMPA (JANELA CONTÍNUA DE 7 DIAS)       */}
      {/* ========================================================================= */}
      {activeTab === 'weekTable' && (
        <div className="bg-white dark:bg-neutral-900 rounded-3xl border border-neutral-200 dark:border-neutral-800 p-6 sm:p-8 shadow-sm space-y-6 animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <h3 className="text-base font-extrabold text-neutral-900 dark:text-neutral-100">
                Cardápio Rampa Completo · Próximos 7 Dias ({rollingDays[0]?.dateStr} a {rollingDays[6]?.dateStr})
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Janela contínua a partir de hoje: quando o primeiro dia acaba, o próximo dia equivalente da semana seguinte entra automaticamente.
              </p>
            </div>

            <button
              onClick={() => setActiveTab('daily')}
              className="px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs"
            >
              <Utensils className="w-4 h-4" />
              <span>Montar Pedido da Semana</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300">
                  <th className="py-3 px-3 font-bold">Dia / Data</th>
                  <th className="py-3 px-3 font-bold">🍚 Arroz & Feijão</th>
                  <th className="py-3 px-3 font-bold">🥩 Prato Principal</th>
                  <th className="py-3 px-3 font-bold">🥔 Guarnição</th>
                  <th className="py-3 px-3 font-bold">🥬 Salada</th>
                  <th className="py-3 px-3 font-bold">🍮 Sobremesa / Fruta</th>
                  <th className="py-3 px-3 font-bold text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {rollingDays.map((slot) => {
                  const acomp = normalizeSlotItems(slot.dayMenu?.lunch?.acompanhamento).join(' + ') || 'Arroz Branco + Feijão Carioca';
                  const princ = slot.principalDishName;
                  const guar = slot.guarnicaoDishName;
                  const salad = slot.saladaDishName;
                  const sobrem = `${slot.sobremesaDishName} (${slot.availableFruit.icon} ${slot.availableFruit.name})`;

                  return (
                    <tr key={slot.isoDate} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/40 transition-colors">
                      <td className="py-3 px-3 font-bold">
                        <div className="flex items-center gap-1.5">
                          <span className="text-neutral-900 dark:text-neutral-100">{slot.dayName}</span>
                          {slot.isToday && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              HOJE
                            </span>
                          )}
                          {slot.isNextWeekWrap && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                              PRÓX. SEM
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-amber-700 dark:text-amber-400 font-mono">{slot.fullDateStr}</span>
                      </td>
                      <td className="py-3 px-3 text-neutral-700 dark:text-neutral-300 font-medium">{acomp}</td>
                      <td className="py-3 px-3 font-bold text-neutral-900 dark:text-neutral-100">{princ}</td>
                      <td className="py-3 px-3 text-neutral-700 dark:text-neutral-300">{guar}</td>
                      <td className="py-3 px-3 text-emerald-800 dark:text-emerald-300">{salad}</td>
                      <td className="py-3 px-3 text-purple-800 dark:text-purple-300">{sobrem}</td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => {
                            setSelectedSlotIso(slot.isoDate);
                            setActiveTab('daily');
                          }}
                          className="px-2.5 py-1 bg-amber-100 dark:bg-amber-950/60 hover:bg-amber-200 text-amber-800 dark:text-amber-300 rounded-lg font-bold text-[11px] cursor-pointer"
                        >
                          Pedir
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: PEDIDOS ENVIADOS & COMPROVANTES (IMPRESSÃO / PDF)                  */}
      {/* ========================================================================= */}
      {activeTab === 'myOrders' && (
        <div className="bg-white dark:bg-neutral-900 rounded-3xl border border-neutral-200 dark:border-neutral-800 p-6 sm:p-8 shadow-sm space-y-6 animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <h3 className="text-base font-extrabold text-neutral-900 dark:text-neutral-100">
                {isMasterOrAdmin ? 'Todos os Pedidos Recebidos na Cozinha' : 'Meus Pedidos de Refeição'}
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Imprima diretamente sem necessidade de baixar ou exporte em arquivo PDF oficial.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {appsScriptUrl && (
                <button
                  type="button"
                  disabled={isSyncingDatabase}
                  onClick={() => void pullUsersFromAppsScript(appsScriptUrl)}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs transition-all disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingDatabase ? 'animate-spin' : ''}`} />
                  <span>{isSyncingDatabase ? 'Sincronizando...' : 'Atualizar da Planilha'}</span>
                </button>
              )}

              <button
                onClick={() => setActiveTab('daily')}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs transition-all"
              >
                <Utensils className="w-4 h-4" />
                <span>Novo Pedido do Cardápio</span>
              </button>
            </div>
          </div>

          {lastSyncError && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-xs flex items-center justify-between gap-3 text-rose-800 dark:text-rose-200">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span className="truncate"><strong>Aviso de sincronização:</strong> {lastSyncError}</span>
              </div>
              {appsScriptUrl && (
                <button
                  type="button"
                  onClick={() => void pullUsersFromAppsScript(appsScriptUrl)}
                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] shrink-0 cursor-pointer"
                >
                  Tentar Novamente
                </button>
              )}
            </div>
          )}

          <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 text-xs flex items-center gap-2.5 text-amber-900 dark:text-amber-200">
            <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              <strong>Regra Automática da Planilha (8 dias):</strong> Cada pedido permanece salvo por 7 dias e é apagado automaticamente no <strong>8º dia</strong> (ex.: pedido feito dia <strong>08/10</strong> é apagado em <strong>15/10</strong>).
            </span>
          </div>

          {visibleOrders.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <FileText className="w-10 h-10 text-neutral-400 mx-auto" />
              <p className="text-sm font-bold text-neutral-700 dark:text-neutral-300">
                Nenhum pedido registrado no momento
              </p>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                Utilize a aba "1. Cardápio do Dia & Fazer Pedido" para escolher o dia e definir o número de pessoas por item.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {visibleOrders.map((order) => {
                const statusColors = {
                  solicitado: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800',
                  aprovado: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
                  em_preparo: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border-sky-300 dark:border-sky-800',
                  entregue: 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 border-neutral-300 dark:border-neutral-700',
                };

                return (
                  <div
                    key={order.id}
                    className="p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-850/50 space-y-4 hover:border-amber-400/50 transition-all"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="font-mono font-black text-xs text-amber-800 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded-md">
                            {order.orderNumber}
                          </span>
                          <h4 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                            {order.departmentOrGroup}
                          </h4>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${statusColors[order.status]}`}>
                            {order.status.replace('_', ' ')}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-mono">
                            8º dia: {getOrderRetentionInfo(order).expirationDateBr}
                          </span>
                          {pendingOrderIds.includes(order.id) && (
                            <button
                              type="button"
                              disabled={retryingOrderId === order.id}
                              onClick={() => void handleRetrySendOrder(order)}
                              className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-800 flex items-center gap-1 cursor-pointer hover:bg-rose-200 disabled:opacity-60"
                            >
                              <RefreshCw className={`w-3 h-3 ${retryingOrderId === order.id ? 'animate-spin' : ''}`} />
                              <span>{retryingOrderId === order.id ? 'Reenviando...' : 'Pendente na Planilha · Reenviar'}</span>
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400 pt-1">
                          <span>Resp: <strong>{order.clientName}</strong></span>
                          <span>·</span>
                          <span>Data da Refeição: <strong>{order.serviceDate} ({order.mealShift})</strong></span>
                          <span>·</span>
                          <span>Dia: <strong>{order.dayName || 'Cardápio Rampa'}</strong></span>
                        </div>
                      </div>

                      {/* Print and PDF Action Buttons */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handlePrintVoucher(order)}
                          className="px-3 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-xl text-xs font-bold text-neutral-800 dark:text-neutral-200 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                          title="Imprimir comprovante diretamente na impressora"
                        >
                          <Printer className="w-3.5 h-3.5 text-amber-600" />
                          <span>Mandar para Impressora</span>
                        </button>

                        <button
                          onClick={() => handleDownloadPdfVoucher(order)}
                          disabled={isGeneratingPdf}
                          className="px-3 py-1.5 bg-neutral-900 hover:bg-black dark:bg-neutral-100 dark:hover:bg-white text-white dark:text-neutral-900 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                          title="Baixar comprovante oficial em formato PDF"
                        >
                          <FileDown className="w-3.5 h-3.5 text-amber-400 dark:text-amber-600" />
                          <span>Baixar em PDF</span>
                        </button>

                        {isMasterOrAdmin && (
                          <select
                            value={order.status}
                            onChange={(e) => updateClientOrderStatus(order.id, e.target.value as any)}
                            className="text-xs font-bold bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl px-2 py-1.5 cursor-pointer"
                          >
                            <option value="solicitado">Solicitado</option>
                            <option value="aprovado">Aprovado</option>
                            <option value="em_preparo">Em Preparo</option>
                            <option value="entregue">Entregue</option>
                          </select>
                        )}

                        {isMasterOrAdmin && (
                          <button
                            onClick={() => {
                              if (confirm(`Deseja remover o pedido ${order.orderNumber}?`)) {
                                deleteClientOrder(order.id);
                              }
                            }}
                            className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                            title="Excluir pedido"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Breakdown of Meal Items by Person */}
                    {order.mealItems && order.mealItems.length > 0 && (
                      <div className="p-3 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200/80 dark:border-neutral-800 text-xs space-y-2">
                        <span className="font-bold text-neutral-700 dark:text-neutral-300 block">
                          🍽️ Quantidades Solicitadas por Número de Pessoas:
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {order.mealItems.map((item, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 font-semibold text-neutral-800 dark:text-neutral-200 text-xs flex items-center gap-1.5"
                            >
                              <span>{item.icon || '🍲'}</span>
                              <span className="text-neutral-600 dark:text-neutral-400">{item.categoryLabel}:</span>
                              <strong className="text-neutral-900 dark:text-neutral-100 font-bold font-mono">
                                {item.peopleCount} pessoas
                              </strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Fruits summary strip */}
                    {order.fruits && order.fruits.length > 0 && (
                      <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-xl border border-amber-200/70 dark:border-amber-900/50 text-xs">
                        <span className="font-bold text-neutral-700 dark:text-neutral-300 block mb-1">
                          🍎 Fruta Escalada para o Pedido:
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {order.fruits.map((fr, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-amber-200 dark:border-amber-900/60 font-semibold text-neutral-800 dark:text-neutral-200 text-xs flex items-center gap-1"
                            >
                              <span>{fr.icon || '🍏'}</span>
                              <span>{fr.name}:</span>
                              <strong className="font-mono text-amber-700 dark:text-amber-400 font-bold">
                                {fr.quantity} {fr.unit}
                              </strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {order.specialDietNotes && (
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 italic">
                        <strong>Obs / Restrições:</strong> {order.specialDietNotes}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DE CONFIRMAÇÃO DO PEDIDO (DIA ÚNICO OU SEMANA COMPLETA)            */}
      {/* ========================================================================= */}
      {showOrderModal && successOrder && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl space-y-6 animate-in zoom-in-95 max-h-[92vh] overflow-y-auto">
            
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[11px] font-black uppercase tracking-wider text-emerald-600 block">
                    {batchOrders.length > 1
                      ? `Pedido Semanal Registrado (${batchOrders.length} dias de uma vez)`
                      : 'Pedido Registrado com Sucesso'}
                  </span>
                  <h3 className="text-xl font-black text-neutral-900 dark:text-neutral-100">
                    {batchOrders.length > 1
                      ? `${batchOrders[0].orderNumber} a ${batchOrders[batchOrders.length - 1].orderNumber}`
                      : `Comprovante Oficial #${successOrder.orderNumber}`}
                  </h3>
                </div>
              </div>

              <button
                onClick={() => setShowOrderModal(false)}
                className="p-2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Live Google Sheets Delivery Status Banner */}
            {orderDeliveryStatus.state !== 'idle' && (
              <div
                className={`p-3.5 rounded-2xl border text-xs space-y-2.5 ${
                  orderDeliveryStatus.state === 'confirmed'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : orderDeliveryStatus.state === 'sending'
                    ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-200'
                    : orderDeliveryStatus.state === 'unverified'
                    ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                    : 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    {orderDeliveryStatus.state === 'sending' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-sky-600 shrink-0 mt-0.5" />
                    ) : orderDeliveryStatus.state === 'confirmed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <span className="font-bold leading-relaxed">{orderDeliveryStatus.message}</span>
                  </div>

                  {(orderDeliveryStatus.state === 'error' || orderDeliveryStatus.state === 'unverified') && (
                    <button
                      type="button"
                      disabled={isSendingBatch || retryingOrderId === successOrder.id}
                      onClick={() =>
                        batchOrders.length > 1
                          ? void handleRetryBatchPending()
                          : void handleRetrySendOrder(successOrder)
                      }
                      className="px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-extrabold text-[11px] shrink-0 cursor-pointer flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3 h-3 ${isSendingBatch || retryingOrderId === successOrder.id ? 'animate-spin' : ''}`} />
                      <span>{batchOrders.length > 1 ? 'Reenviar Pendentes' : 'Reenviar Agora'}</span>
                    </button>
                  )}
                </div>

                {orderDeliveryStatus.state === 'no_url' && (
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="url"
                        value={inlineScriptInput}
                        onChange={(e) => setInlineScriptInput(e.target.value)}
                        placeholder="https://script.google.com/macros/s/.../exec"
                        className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-neutral-900 border border-rose-300 dark:border-rose-700 text-xs font-mono text-neutral-900 dark:text-neutral-100"
                      />
                      <button
                        type="button"
                        disabled={isSendingBatch || retryingOrderId === successOrder.id}
                        onClick={() =>
                          batchOrders.length > 1
                            ? void handleRetryBatchPending(inlineScriptInput)
                            : void handleRetrySendOrder(successOrder, inlineScriptInput)
                        }
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs cursor-pointer shrink-0 flex items-center justify-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Conectar e Enviar Agora</span>
                      </button>
                    </div>
                    {inlineConnectError && (
                      <p className="text-[11px] font-bold text-rose-700 dark:text-rose-300">{inlineConnectError}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Batch Week Summary OR Single Day Summary */}
            {batchOrders.length > 1 ? (
              <div className="p-4 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-2xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span><strong>Grupo:</strong> {batchOrders[0].departmentOrGroup}</span>
                  <span><strong>Turno:</strong> {batchOrders[0].mealShift} · <strong>{batchOrders.length} dias</strong></span>
                </div>

                <div className="space-y-2 pt-2 border-t border-amber-200/80 dark:border-amber-900/60 max-h-60 overflow-y-auto pr-1">
                  {batchOrders.map((ord) => {
                    const syncState = batchSyncMap[ord.id] || 'pending';
                    const princItem = ord.mealItems?.find((m) => m.category === 'principal');
                    return (
                      <div
                        key={ord.id}
                        className="bg-white dark:bg-neutral-800 p-2.5 rounded-xl border border-amber-200/70 dark:border-amber-800/60 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-black text-[11px] text-amber-800 dark:text-amber-300">
                              {ord.orderNumber}
                            </span>
                            <strong className="text-neutral-900 dark:text-neutral-100">
                              {ord.dayName} ({ord.serviceDate})
                            </strong>
                          </div>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                            Princ: {princItem?.peopleCount ?? ord.numberOfPeople} pax
                            {ord.fruits?.[0] ? ` · ${ord.fruits[0].icon} ${ord.fruits[0].name}: ${ord.fruits[0].quantity} ${ord.fruits[0].unit}` : ''}
                          </p>
                        </div>

                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full shrink-0 ${
                            syncState === 'confirmed'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : syncState === 'sending'
                              ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                              : syncState === 'unverified'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : syncState === 'error'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'
                          }`}
                        >
                          {syncState === 'confirmed'
                            ? '✓ Planilha OK'
                            : syncState === 'sending'
                            ? 'Enviando...'
                            : syncState === 'unverified'
                            ? 'Enviado'
                            : syncState === 'error'
                            ? 'Pendente'
                            : 'Na fila'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-2xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span><strong>Grupo:</strong> {successOrder.departmentOrGroup}</span>
                  <span><strong>Data:</strong> {successOrder.serviceDate} ({successOrder.mealShift})</span>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-amber-200/80 dark:border-amber-900/60">
                  <strong className="text-xs text-amber-950 dark:text-amber-200 block">
                    Quantidades Confirmadas por Pessoa:
                  </strong>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    {successOrder.mealItems?.map((it, idx) => (
                      <div key={idx} className="bg-white dark:bg-neutral-800 p-2 rounded-lg border border-amber-200/70 dark:border-amber-800/60 flex items-center justify-between">
                        <span className="text-neutral-700 dark:text-neutral-300 font-medium truncate mr-1">
                          {it.icon} {it.categoryLabel}:
                        </span>
                        <strong className="font-mono text-amber-700 dark:text-amber-400 font-black">
                          {it.peopleCount} pax
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>

                {successOrder.fruits && successOrder.fruits.length > 0 && (
                  <div className="pt-2 border-t border-amber-200/80 dark:border-amber-900/60 text-xs flex items-center justify-between">
                    <span><strong>Fruta Disponível do Dia:</strong> {successOrder.fruits[0].icon} {successOrder.fruits[0].name}</span>
                    <strong className="text-amber-700 dark:text-amber-400 font-mono font-black">
                      {successOrder.fruits[0].quantity} {successOrder.fruits[0].unit}
                    </strong>
                  </div>
                )}
              </div>
            )}

            {/* Two Main Actions: Mandar para Impressora & Baixar em PDF */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handlePrintVoucher(successOrder, batchOrders.length > 1)}
                  className="py-3 px-4 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs sm:text-sm rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>{batchOrders.length > 1 ? 'Imprimir Semana Completa' : 'Mandar para Impressora'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadPdfVoucher(successOrder, batchOrders.length > 1)}
                  disabled={isGeneratingPdf}
                  className="py-3 px-4 bg-neutral-900 hover:bg-black dark:bg-neutral-100 dark:hover:bg-white text-white dark:text-neutral-900 font-extrabold text-xs sm:text-sm rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileDown className="w-4 h-4 text-amber-400 dark:text-amber-600" />
                  <span>{batchOrders.length > 1 ? 'Baixar PDF da Semana' : 'Baixar em PDF'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowOrderModal(false);
                  if (!isClient) setActiveTab('myOrders');
                }}
                className="w-full py-2.5 text-center text-xs font-bold text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors cursor-pointer"
              >
                {isClient ? 'Concluir e Fechar Comprovante' : 'Concluir e Ver Todos os Meus Pedidos'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* HIDDEN / VOUCHER PRINT TEMPLATE (PREPARO PARA IMPRESSÃO DIRETA & PDF)     */}
      {/* ========================================================================= */}
      {successOrder && (
        <div style={{ display: 'none' }}>
          <div
            ref={orderVoucherRef}
            className="p-8 bg-white text-neutral-900 font-sans max-w-2xl mx-auto"
            style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
          >
            {/* Header */}
            <div style={{ borderBottom: '2px solid #b45309', paddingBottom: '16px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: '900', margin: '0', textTransform: 'uppercase', color: '#b45309' }}>
                    Canção Nova · Restaurante & Refeitório Central
                  </h1>
                  <p style={{ fontSize: '12px', margin: '2px 0 0', color: '#525252' }}>
                    {batchOrders.length > 1
                      ? `Comprovante Semanal Consolidado (${batchOrders.length} dias) · Cardápio Rampa`
                      : 'Comprovante Oficial de Solicitação do Cardápio Rampa'}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '14px', fontWeight: 'bold', fontFamily: 'monospace', color: '#171717' }}>
                    {batchOrders.length > 1
                      ? `${batchOrders[0].orderNumber} a ${batchOrders[batchOrders.length - 1].orderNumber}`
                      : successOrder.orderNumber}
                  </span>
                  <p style={{ fontSize: '10px', color: '#737373', margin: '2px 0 0' }}>
                    Emissão: {successOrder.orderDate}
                  </p>
                </div>
              </div>
            </div>

            {/* Order Info Details */}
            <div style={{ backgroundColor: '#f5f5f5', borderRadius: '8px', padding: '14px', marginBottom: '18px', fontSize: '12px', lineHeight: '1.6' }}>
              <p style={{ margin: '0 0 4px' }}><strong>Setor / Evento:</strong> {successOrder.departmentOrGroup}</p>
              <p style={{ margin: '0 0 4px' }}><strong>Responsável:</strong> {successOrder.clientName} ({successOrder.clientEmail})</p>
              <p style={{ margin: '0 0 4px' }}><strong>Telefone de Contato:</strong> {successOrder.clientPhone || 'Não informado'}</p>
              {batchOrders.length > 1 ? (
                <p style={{ margin: '0', fontSize: '13px', color: '#b45309' }}>
                  <strong>Período Solicitado:</strong> {batchOrders[0].serviceDate} até {batchOrders[batchOrders.length - 1].serviceDate} ({successOrder.mealShift})
                </p>
              ) : (
                <>
                  <p style={{ margin: '0 0 4px' }}><strong>Data da Refeição:</strong> {successOrder.serviceDate} ({successOrder.mealShift})</p>
                  <p style={{ margin: '0', fontSize: '13px', color: '#b45309' }}>
                    <strong>Dia do Cardápio:</strong> {successOrder.dayName || 'Cardápio Rampa'}
                  </p>
                </>
              )}
            </div>

            {batchOrders.length > 1 ? (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', margin: '0 0 8px', textTransform: 'uppercase', borderBottom: '1px solid #e5e5e5', paddingBottom: '4px' }}>
                  Detalhamento Semanal por Dia (Rampa & Fruta)
                </h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#fef3c7', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>Protocolo</th>
                      <th style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>Dia / Data</th>
                      <th style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>Quantidades (Arroz/Feij/Princ/Guar/Sal/Sobr)</th>
                      <th style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>Fruta do Dia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchOrders.map((ord) => {
                      const counts = (ord.mealItems || [])
                        .map((m) => `${m.categoryLabel.split(' ')[0]}:${m.peopleCount}`)
                        .join(' · ');
                      const frText = ord.fruits?.[0]
                        ? `${ord.fruits[0].name} (${ord.fruits[0].quantity} ${ord.fruits[0].unit})`
                        : '-';
                      return (
                        <tr key={ord.id} style={{ borderBottom: '1px solid #e5e5e5' }}>
                          <td style={{ padding: '6px 8px', border: '1px solid #e5e5e5', fontFamily: 'monospace', fontWeight: 'bold' }}>{ord.orderNumber}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #e5e5e5', fontWeight: 'bold' }}>{ord.dayName} ({ord.serviceDate})</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>{counts}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>{frText}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                {/* Itemized Meal Quantities Breakdown Table */}
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '13px', fontWeight: 'bold', margin: '0 0 8px', textTransform: 'uppercase', borderBottom: '1px solid #e5e5e5', paddingBottom: '4px' }}>
                    Itens do Cardápio e Quantidades por Número de Pessoas
                  </h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#fef3c7', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>Categoria</th>
                        <th style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>Prato Oficial da Rampa</th>
                        <th style={{ padding: '6px 8px', border: '1px solid #e5e5e5', textAlign: 'right' }}>Qtd (Pessoas)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {successOrder.mealItems && successOrder.mealItems.length > 0 ? (
                        successOrder.mealItems.map((item, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #e5e5e5' }}>
                            <td style={{ padding: '6px 8px', border: '1px solid #e5e5e5', fontWeight: 'bold' }}>
                              {item.icon} {item.categoryLabel}
                            </td>
                            <td style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>
                              {item.dishName}
                            </td>
                            <td style={{ padding: '6px 8px', border: '1px solid #e5e5e5', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>
                              {item.peopleCount} pessoas
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} style={{ padding: '8px', textAlign: 'center' }}>
                            Total de comensais solicitados: {successOrder.numberOfPeople} pessoas
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Single Available Fruit Breakdown Table */}
                {successOrder.fruits && successOrder.fruits.length > 0 && (
                  <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 'bold', margin: '0 0 8px', textTransform: 'uppercase', borderBottom: '1px solid #e5e5e5', paddingBottom: '4px' }}>
                      Fruta Oficial Disponível no Dia ({successOrder.dayName})
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#fef3c7', textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>Fruta Escalada</th>
                          <th style={{ padding: '6px 8px', border: '1px solid #e5e5e5', textAlign: 'right' }}>Quantidade</th>
                          <th style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>Unidade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {successOrder.fruits.map((fr, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #e5e5e5' }}>
                            <td style={{ padding: '6px 8px', border: '1px solid #e5e5e5', fontWeight: 'bold' }}>{fr.icon} {fr.name}</td>
                            <td style={{ padding: '6px 8px', border: '1px solid #e5e5e5', textAlign: 'right', fontWeight: 'bold' }}>{fr.quantity}</td>
                            <td style={{ padding: '6px 8px', border: '1px solid #e5e5e5' }}>{fr.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Special Diet Notes */}
            {successOrder.specialDietNotes && (
              <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px', fontSize: '11px', marginBottom: '24px' }}>
                <strong>Observações Nutricionais / Restrições:</strong> {successOrder.specialDietNotes}
              </div>
            )}

            {/* Signatures */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '40px', paddingTop: '10px', fontSize: '11px', textAlign: 'center' }}>
              <div style={{ width: '45%', borderTop: '1px solid #a3a3a3', paddingTop: '6px' }}>
                Assinatura do Solicitante ({successOrder.clientName})
              </div>
              <div style={{ width: '45%', borderTop: '1px solid #a3a3a3', paddingTop: '6px' }}>
                Nutrição / Cozinha Central Canção Nova
              </div>
            </div>

            <p style={{ textAlign: 'center', fontSize: '10px', color: '#a3a3a3', marginTop: '24px' }}>
              CardápioPro Canção Nova · Sistema Integrado de Gestão Nutricional
            </p>
          </div>
        </div>
      )}

    </div>
  );
};
