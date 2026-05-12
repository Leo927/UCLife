import json5 from 'json5'
import raw from './dialogue-text.json5?raw'

export interface DialogueText {
  timings: {
    farewellCloseMs: number
  }
  greetings: Record<string, string>
  smallTalk: Record<string, string>
  farewells: Record<string, string>
  buttons: {
    smallTalk: string
    farewell: string
    back: string
    shop: string
    hr: string
    realtor: string
    seller: string
    ae: string
    shipDealer: string
    clinic: string
    pharmacy: string
    secretary: string
    recruiter: string
    researcher: string
    factoryManager: string
    jobSite: string
    talkHire: string
    hangarManager: string
    aeSupplyDealer: string
    aeShipSales: string
    hireAsCaptain: string
    hireAsCrew: string
  }
  branches: {
    shop: { title: string; intro: string }
    hr: { title: string; empty: string }
    realtor: {
      title: string
      moneyLabel: string
      tabs: { residential: string; commercial: string; factionMisc: string }
      tabHelp: { residential: string; commercial: string; factionMisc: string }
      empty: string
      sectionDormSale: string
    }
    seller: { title: string; intro: string }
    ae: { titleSuffix: string; intro: string; empty: string }
    shipDealer: { title: string }
    clinic: { title: string; noSymptoms: string; treatmentHeader: string }
    pharmacy: { title: string; noSymptoms: string; undiagnosedHint: string }
    secretary: { title: string }
    recruiter: {
      titleSuffix: string
      lobbyHeader: string
      lobbyEmpty: string
      noFilter: string
      replyNoFilter: string
    }
    researcher: {
      title: string
      titleSuffix: string
      idleReply: string
      cancelHeadConfirm: string
      plannerTitle: string
      todayLabel: string
      lostLabel: string
      queueHeader: string
      availableHeader: string
      lockedHeader: string
      doneHeader: string
      emptyQueueHint: string
      emptyAvailableHint: string
      emptyLockedHint: string
      emptyDoneHint: string
    }
    factoryManager: { title: string; empty: string }
    jobSite: {
      fire: string
      replaceFromIdle: string
      pickFromAll: string
      pickIntro: string
      pickEmpty: string
    }
    talkHire: {
      title: string
      decline: string
      gateClosed: string
      gateOpen: string
    }
    hangarManager: {
      titleSuffix: string
      tierLabel: { surface: string; drydock: string }
      slotLabel: { ms: string; smallCraft: string; capital: string }
      emptyHint: string
      intro: string
      repairHeader: string
      repairThroughputLabel: string
      repairUnit: string
      repairEmpty: string
      repairPriorityActive: string
      repairPriorityNone: string
      repairFocusButton: string
      repairClearButton: string
      repairShipDeficit: string
      supplyHeader: string
      supplyLabel: string
      fuelLabel: string
      supplyPending: string
      supplyPendingUnit: string
      supplyDryBadge: string
      fuelDryBadge: string
      deliveriesHeader: string
      deliveriesEmpty: string
      deliveryInTransitFmt: string
      deliveryArrivedFmt: string
      receiveDeliveryButton: string
      receiveDeliveryNoSlot: string
      toastDeliveryReceived: string
      toastDeliveryFailed: string
      transferHeader: string
      transferIntro: string
      transferEmpty: string
      transferPickShipLabel: string
      transferPickDestLabel: string
      transferConfirmButton: string
      transferConfirmFmt: string
      transferToastQueued: string
      transferToastFailed: string
      transferDestNoSlot: string
      transferSlotLabel: string
      transferRouteFeeLabel: string
      transferRouteTripLabel: string
      transferRouteDaysLabel: string
      transferBack: string
    }
    aeSupplyDealer: {
      titleSuffix: string
      intro: string
      orderSupplyLabel: string
      orderFuelLabel: string
      qtyLabel: string
      priceLabel: string
      totalLabel: string
      targetHangarLabel: string
      orderButton: string
      orderConfirmed: string
      orderInsufficient: string
      orderInvalid: string
      etaLabel: string
      etaUnit: string
      noHangars: string
    }
    secretaryBulkOrder: {
      header: string
      bulkSupplyButton: string
      bulkFuelButton: string
      bulkUnit: string
      bulkMarkup: string
      bulkEta: string
      bulkOrderPlaced: string
      bulkNoHangar: string
      bulkInsufficient: string
      kindSupply: string
      kindFuel: string
    }
    fleetSupplyHud: {
      supplyLabel: string
      fuelLabel: string
    }
    fleetRoster: {
      title: string
      openButton: string
      empty: string
      colShip: string
      colState: string
      colHangar: string
      colCaptain: string
      colHull: string
      colArmor: string
      colActions: string
      stateInPort: string
      stateActive: string
      stateReserve: string
      flagshipBadge: string
      captainEmpty: string
      mothballButton: string
      mothballUndoButton: string
      scrapButton: string
      mothballStubToast: string
      scrapStubToast: string
      stateMothballed: string
      mothballFlagshipTooltip: string
      mothballInTransitTooltip: string
      mothballToastDone: string
      mothballToastUndone: string
      mothballToastFailed: string
      crewButton: string
      crewSectionTitle: string
      crewEmpty: string
      crewCaptainLabel: string
      crewMemberLabel: string
      crewMoveTo: string
      crewMoveLabel: string
      crewFireLabel: string
      crewHireFromIdleLabel: string
      crewHireFromIdleLong: string
      crewHireFromIdleEmpty: string
      crewToastMoved: string
      crewToastFired: string
      crewToastFireCaptain: string
      crewToastHired: string
      crewToastHireNoFunds: string
      crewToastHireNoneAvailable: string
      crewToastMoveFailed: string
      crewVacancyLabel: string
      crewBackButton: string
    }
    hireAsCaptain: {
      title: string
      intro: string
      feeLine: string
      pickButton: string
      toastHired: string
      toastFailed: string
      toastNoFunds: string
    }
    hireAsCrew: {
      title: string
      intro: string
      feeLine: string
      vacancyLabel: string
      pickButton: string
      toastHired: string
      toastFailed: string
      toastNoFunds: string
    }
    captainsOfficeManRest: {
      buttonIdle: string
      buttonNoVacancy: string
      buttonNoCaptain: string
      toastFilled: string
      toastNoIdle: string
      toastNoFunds: string
      toastCap: string
    }
    warRoom: {
      title: string
      intro: string
      activeGridHeader: string
      reserveTrayHeader: string
      reserveEmpty: string
      aggressionHeader: string
      emptySlotLabel: string
      flagshipBadge: string
      stateActive: string
      stateReserve: string
      toastFlagshipLocked: string
      toastMoveFailed: string
      rosterStateLabel: string
      rosterAggressionLabel: string
      transitLabel: string
      transitToastQueued: string
    }
    aeShipSales: {
      title: string
      moneyLabel: string
      statHull: string
      statArmor: string
      statSpeed: string
      statFuel: string
      statSupplies: string
      statMounts: string
      statCrew: string
      statSlot: string
      slotLabel: { ms: string; smallCraft: string; capital: string }
      slotFull: string
      deliverHeader: string
      buyButton: string
      buyDisabledMoney: string
      buyDisabledNoSlot: string
      gateNoHangar: string
      gateNoSlot: string
      gateNoMoney: string
      toastNoHangar: string
      toastBought: string
      pendingHeader: string
      pendingDays: string
      pendingArrived: string
    }
  }
}

export const dialogueText = json5.parse(raw) as DialogueText

// Picks a string from a category by job-title substring. Falls back to
// `default` (or `unemployed` when not employed) when no key matches.
export function pickByTitle(
  table: Record<string, string>,
  title: string,
  employed: boolean,
): string {
  if (!employed && table.unemployed) return table.unemployed
  if (title.includes('店员') && table.cashier) return table.cashier
  if (title.includes('人事') && table.hr) return table.hr
  if (title.includes('中介') && table.realtor) return table.realtor
  if (title.includes('经理') && table.manager) return table.manager
  if (title.includes('调酒') && table.bartender) return table.bartender
  if (title.includes('医生') && table.doctor) return table.doctor
  if (title.includes('药剂师') && table.pharmacist) return table.pharmacist
  if (title.includes('工程') && table.aeEngineer) return table.aeEngineer
  if (title.includes('工人') && table.worker) return table.worker
  return table.default ?? ''
}
