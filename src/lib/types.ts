export type CueStatus = 'pending' | 'confirmed' | 'followup'
export type TabId = 'live' | 'backstage' | 'terms' | 'offline' | 'handover'
export type HandoverStatus = 'pending' | 'confirmed' | 'superseded'

export interface Speaker {
  id: string
  name: string
  title: string
  language: string
  color: string
}

export interface Session {
  id: string
  order: number
  time: string
  title: string
  speakerId: string
  room: string
  status: 'upcoming' | 'live' | 'done'
}

export interface Term {
  id: string
  source: string
  target: string
  note: string
  speakerId: string
  priority: 'normal' | 'high'
}

export interface Announcement {
  id: string
  level: 'info' | 'warning' | 'urgent'
  text: string
  visibleOnStage: boolean
  createdAt: string
}

export interface Cue {
  id: string
  speakerId: string
  text: string
  receivedAt: number
  status: CueStatus
  manual: boolean
  offline: boolean
  delaySeconds: number
  duplicateOf: string | null
  followupText: string
  tags: string[]
}

export interface Reminder {
  id: string
  termId: string
  cueId: string
  target: string
  createdAt: number
  acknowledged: boolean
}

export interface HandoverReminderItem {
  reminderId: string
  target: string
  priority: 'normal' | 'high'
  handedOff: boolean
}

export interface Handover {
  id: string
  fromLabel: string
  toLabel: string
  createdAt: number
  /** 业务时间归属分界：receivedAt <= cutoff 归旧班 */
  cutoff: number
  /** 确认交接那一刻冻结的可见队列 */
  frozenCueIds: string[]
  /** 冻结时未确认的提醒，高优先须逐条交清 */
  reminderItems: HandoverReminderItem[]
  /** 冻结时仍仅后台的通知，不随交接发布到现场 */
  backstageAnnouncementIds: string[]
  status: HandoverStatus
  confirmedAt: number | null
  /** 两人同时提交同一交接时，两版共享同一冲突组并都保留 */
  conflictGroup: string | null
}

export interface DeskState {
  speakers: Speaker[]
  sessions: Session[]
  terms: Term[]
  announcements: Announcement[]
  cues: Cue[]
  reminders: Reminder[]
  handovers: Handover[]
  shiftLabel: string
  activeCueId: string
  fontScale: number
  online: boolean
  liveSimulation: boolean
  updatedAt: string
}
