export type CueStatus = 'pending' | 'confirmed' | 'followup'
export type TabId = 'live' | 'handovers' | 'backstage' | 'terms' | 'offline'

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
  /** 业务时间：段落实际发言时间；离线补录可早于到达（入库）时间。归属按此时间计算。 */
  businessTime: number
  /** 归属班次：按业务时间落在哪一班的值守区间决定，不因换班动作而改变。 */
  ownerShiftId: string
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
  ownerShiftId: string
}

/** 口译班次（同传席）。endedAt 为 null 表示当前值守班。 */
export interface InterpreterShift {
  id: string
  order: number
  label: string
  interpreterName: string
  startedAt: number
  endedAt: number | null
}

/** 交接冻结时的队列快照行（不可变，仅记录本版冻结瞬间的状态）。 */
export interface CueLineSnapshot {
  cueId: string
  text: string
  speakerId: string
  businessTime: number
  status: CueStatus
  ownerShiftId: string
}

/** 交接冻结时的未确认术语提醒快照行（不可变）。 */
export interface ReminderLineSnapshot {
  reminderId: string
  termId: string
  cueId: string
  target: string
  priority: 'normal' | 'high'
  createdAt: number
  ownerShiftId: string
}

/** 交接冻结时的后台通知快照行（不可变，仅记录发布状态，不改变现场可见性）。 */
export interface AnnouncementLineSnapshot {
  announcementId: string
  level: 'info' | 'warning' | 'urgent'
  text: string
  visibleOnStage: boolean
}

export type HandoverStatus = 'open' | 'completed'

export interface HandoverVersion {
  id: string
  groupId: string
  label: string
  /** 提交本版时所基于的状态版本号；与当前版本号不一致即为并发（双人并提）提交。 */
  createdFromRevision: number
  createdAt: number
  cutoffAt: number
  fromShiftId: string
  toShiftId: string
  fromInterpreterName: string
  toInterpreterName: string
  cueLines: CueLineSnapshot[]
  reminderLines: ReminderLineSnapshot[]
  announcementLines: AnnouncementLineSnapshot[]
  status: HandoverStatus
}

/** 旧班尚未转交的段落：冻结时未确认项 + 交接后晚到/离线补录项。 */
export interface PendingTransferLine {
  cueId: string
  businessTime: number
  transferred: boolean
  transferredAt: number | null
  /** frozen：冻结队列内未确认；late：交接后到达或离线补录（按业务时间仍归旧班）。 */
  source: 'frozen' | 'late'
  /** 哪些版本的冻结快照包含该条，用于指出两版之间的归属变化。 */
  appearedInVersionIds: string[]
}

/** 一次换班的版本组：同一交接被两人同时提交时保留多版，共用同一条转交流程。 */
export interface HandoverGroup {
  id: string
  cutoffAt: number
  fromShiftId: string
  toShiftId: string
  versionIds: string[]
  primaryVersionId: string
  status: HandoverStatus
  completedAt: number | null
  pendingLines: PendingTransferLine[]
}

export interface DeskState {
  speakers: Speaker[]
  sessions: Session[]
  terms: Term[]
  announcements: Announcement[]
  cues: Cue[]
  reminders: Reminder[]
  shifts: InterpreterShift[]
  activeShiftId: string
  handoverGroups: HandoverGroup[]
  handoverVersions: HandoverVersion[]
  activeCueId: string
  fontScale: number
  online: boolean
  liveSimulation: boolean
  /** 每次提交自增的乐观锁版本号，用于识别双人并提。 */
  revision: number
  updatedAt: string
}
