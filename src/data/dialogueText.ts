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
    factoryManager: string
    jobSite: string
    talkHire: string
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
