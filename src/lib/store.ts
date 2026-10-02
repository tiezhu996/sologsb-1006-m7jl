import { writable, get } from 'svelte/store'
import type {
  Announcement, AnnouncementLineSnapshot, Cue, CueLineSnapshot, CueStatus, DeskState, HandoverGroup,
  HandoverStatus, HandoverVersion, InterpreterShift, PendingTransferLine, Reminder, ReminderLineSnapshot,
  Session, Speaker, Term
} from './types'

const STORAGE_KEY = 'conference-cue-desk-v1'

const speakers: Speaker[] = [
  { id: 'sp-1', name: 'Dr. Maya Chen', title: '首席气候科学家', language: '英语 → 中文', color: '#0f766e' },
  { id: 'sp-2', name: '刘启明', title: '城市韧性研究员', language: '中文 → 英语', color: '#b45309' },
  { id: 'sp-3', name: 'Prof. Daniel Ortiz', title: '公共卫生政策顾问', language: '西班牙语 → 中文', color: '#6d28d9' },
  { id: 'sp-4', name: '佐藤 美咲', title: '社区能源设计师', language: '日语 → 中文', color: '#be123c' }
]
const sessions: Session[] = [
  { id: 'se-1', order: 1, time: '09:00', title: '开幕式与议程说明', speakerId: 'sp-2', room: '主会场 A', status: 'done' },
  { id: 'se-2', order: 2, time: '09:20', title: '城市热岛与适应性基础设施', speakerId: 'sp-1', room: '主会场 A', status: 'live' },
  { id: 'se-3', order: 3, time: '10:05', title: '社区健康数据的地方行动', speakerId: 'sp-3', room: '主会场 A', status: 'upcoming' },
  { id: 'se-4', order: 4, time: '10:45', title: '分布式能源与社区共治', speakerId: 'sp-4', room: '主会场 A', status: 'upcoming' }
]
const terms: Term[] = [
  { id: 'term-1', source: 'urban heat island', target: '城市热岛', note: '首次出现完整译出，后可简称热岛', speakerId: 'sp-1', priority: 'high' },
  { id: 'term-2', source: 'resilience', target: '韧性', note: '不使用“恢复力”', speakerId: 'sp-1', priority: 'high' },
  { id: 'term-3', source: 'co-benefit', target: '协同效益', note: '环境与健康共同收益', speakerId: 'sp-1', priority: 'normal' },
  { id: 'term-4', source: 'distributed energy resource', target: '分布式能源资源', note: '缩写 DER', speakerId: 'sp-4', priority: 'high' },
  { id: 'term-5', source: 'health equity', target: '健康公平', note: '不译为健康平等', speakerId: 'sp-3', priority: 'high' }
]

function initialShifts(now: number): InterpreterShift[] {
  return [{ id: 'shift-1', order: 1, label: 'A 班', interpreterName: 'A 班译员', startedAt: now - 90 * 60000, endedAt: null }]
}
function initialCues(now: number, ownerShiftId: string): Cue[] {
  return [
    { id: 'cue-101', speakerId: 'sp-1', text: 'The urban heat island effect is not evenly distributed across a city.', businessTime: now - 36000, receivedAt: now - 36000, ownerShiftId, status: 'confirmed', manual: false, offline: false, delaySeconds: 4, duplicateOf: null, followupText: '', tags: ['城市热岛'] },
    { id: 'cue-102', speakerId: 'sp-1', text: 'Neighborhoods with less tree canopy can be several degrees warmer at night.', businessTime: now - 19000, receivedAt: now - 19000, ownerShiftId, status: 'confirmed', manual: false, offline: false, delaySeconds: 6, duplicateOf: null, followupText: '补译：“夜间温差可达数摄氏度。”', tags: ['树冠覆盖率'] },
    { id: 'cue-103', speakerId: 'sp-1', text: 'Our resilience strategy links cooling corridors with public health investments.', businessTime: now - 9000, receivedAt: now - 9000, ownerShiftId, status: 'pending', manual: false, offline: false, delaySeconds: 11, duplicateOf: null, followupText: '', tags: ['韧性', '协同效益'] },
    { id: 'cue-104', speakerId: 'sp-1', text: 'That data also reveals health equity gaps between districts.', businessTime: now - 2500, receivedAt: now - 2500, ownerShiftId, status: 'pending', manual: false, offline: false, delaySeconds: 4, duplicateOf: null, followupText: '', tags: ['健康公平'] }
  ]
}
function initialReminders(ownerShiftId: string): Reminder[] {
  return [
    { id: 'rem-demo-1', termId: 'term-2', cueId: 'cue-103', target: '韧性', createdAt: Date.now() - 8000, acknowledged: false, ownerShiftId }
  ]
}
function demoState(): DeskState {
  const now = Date.now()
  const shifts = initialShifts(now)
  return {
    speakers, sessions, terms,
    cues: initialCues(now, shifts[0].id),
    reminders: initialReminders(shifts[0].id),
    shifts, activeShiftId: shifts[0].id,
    handoverGroups: [], handoverVersions: [],
    activeCueId: 'cue-103', fontScale: 100,
    announcements: [
      { id: 'ann-1', level: 'info', text: '十点整有消防联动测试，请提醒会场人员保持镇定。', visibleOnStage: false, createdAt: new Date().toISOString() },
      { id: 'ann-2', level: 'urgent', text: '请下一位发言人提前到侧台候场。', visibleOnStage: false, createdAt: new Date().toISOString() }
    ],
    online: true, liveSimulation: true, revision: 0, updatedAt: new Date().toISOString()
  }
}

function clone<T>(value: T): T { return structuredClone(value) }

function loadState(): DeskState {
  const fallback = demoState()
  if (typeof localStorage === 'undefined') return fallback
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return fallback
    const parsed = JSON.parse(saved) as Partial<DeskState>
    // 旧存档（换班功能上线前）补齐班次与交接字段，历史段落整体归入首个班次。
    const shifts: InterpreterShift[] = Array.isArray(parsed.shifts) && parsed.shifts.length
      ? parsed.shifts
      : initialShifts(Date.now())
    const activeShiftId = parsed.activeShiftId || shifts[shifts.length - 1].id
    const cues = (parsed.cues || []).map((cue: Partial<Cue>) => ({
      ...(cue as Cue),
      businessTime: typeof cue.businessTime === 'number' ? cue.businessTime : cue.receivedAt ?? Date.now(),
      ownerShiftId: cue.ownerShiftId || shifts[0].id
    }))
    const reminders = (parsed.reminders || []).map((reminder: Partial<Reminder>) => ({
      ...(reminder as Reminder),
      ownerShiftId: reminder.ownerShiftId || shiftOwnerAt(shifts, reminder.createdAt ?? Date.now())
    }))
    return {
      ...fallback, ...parsed,
      cues, reminders, shifts, activeShiftId,
      handoverGroups: Array.isArray(parsed.handoverGroups) ? parsed.handoverGroups : [],
      handoverVersions: Array.isArray(parsed.handoverVersions) ? parsed.handoverVersions : [],
      revision: typeof parsed.revision === 'number' ? parsed.revision : 0,
      online: typeof navigator !== 'undefined' ? navigator.onLine : Boolean(parsed.online)
    }
  } catch { return fallback }
}

const history: DeskState[] = []
const future: DeskState[] = []
export const desk = writable<DeskState>(loadState())

function persist(state: DeskState) {
  state.updatedAt = new Date().toISOString()
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}
function commit(recipe: (state: DeskState) => void) {
  const current = clone(get(desk))
  const next = clone(current)
  recipe(next)
  next.revision += 1
  history.push(current)
  if (history.length > 60) history.shift()
  future.length = 0
  persist(next)
  desk.set(next)
}
export function undoDesk() {
  const previous = history.pop()
  if (!previous) return
  future.push(clone(get(desk)))
  desk.set(previous); persist(previous)
}
export function redoDesk() {
  const next = future.pop()
  if (!next) return
  history.push(clone(get(desk)))
  desk.set(next); persist(next)
}
export const canUndo = () => history.length > 0
export const canRedo = () => future.length > 0

export function addSpeaker() {
  commit(state => state.speakers.push({ id: `sp-${Date.now()}`, name: '新发言人', title: '待填写机构与职务', language: '待设置语言方向', color: '#475569' }))
}
export function updateSpeaker(id: string, patch: Partial<Speaker>) { commit(state => { const item = state.speakers.find(row => row.id === id); if (item) Object.assign(item, patch) }) }
export function addSession() {
  commit(state => state.sessions.push({ id: `se-${Date.now()}`, order: Math.max(0, ...state.sessions.map(item => item.order)) + 1, time: '11:30', title: '新演讲', speakerId: state.speakers[0]?.id || '', room: '主会场 A', status: 'upcoming' }))
}
export function updateSession(id: string, patch: Partial<Session>) { commit(state => { const item = state.sessions.find(row => row.id === id); if (item) Object.assign(item, patch) }) }
export function addTerm() { commit(state => state.terms.push({ id: `term-${Date.now()}`, source: 'new term', target: '新术语', note: '', speakerId: state.speakers[0]?.id || '', priority: 'normal' })) }
export function updateTerm(id: string, patch: Partial<Term>) { commit(state => { const item = state.terms.find(row => row.id === id); if (item) Object.assign(item, patch) }) }
export function addAnnouncement(text: string, level: Announcement['level']) {
  if (!text.trim()) return
  commit(state => state.announcements.unshift({ id: `ann-${Date.now()}`, level, text: text.trim(), visibleOnStage: false, createdAt: new Date().toISOString() }))
}
export function publishAnnouncement(id: string, visible: boolean) { commit(state => { const item = state.announcements.find(row => row.id === id); if (item) item.visibleOnStage = visible }) }

export function setOnline(online: boolean) {
  commit(state => {
    state.online = online
    if (online) {
      state.cues.forEach(cue => {
        if (cue.offline) {
          cue.offline = false
          const duplicate = findDuplicate(cue.text, state.cues.filter(item => item.id !== cue.id && !item.offline))
          cue.duplicateOf = duplicate?.id || null
        }
      })
    }
  })
}
export function setLiveSimulation(enabled: boolean) { commit(state => { state.liveSimulation = enabled }) }
export function setActiveCue(id: string) { commit(state => { state.activeCueId = id }) }
export function moveCue(direction: 1 | -1) {
  const state = get(desk)
  const visible = visibleCueIds(state)
  const index = visible.indexOf(state.activeCueId)
  const nextId = visible[index + direction]
  if (nextId) setActiveCue(nextId)
}
export function setFontScale(scale: number) { commit(state => { state.fontScale = Math.min(150, Math.max(85, scale)) }) }

/* ------------------------------------------------------------------ */
/* 换班移交                                                             */
/* ------------------------------------------------------------------ */

/** 按业务时间确定归属班次（业务时间 ≤ 截止点的段落归旧班，即使入库更晚）。 */
export function shiftOwnerAt(shifts: InterpreterShift[], businessTime: number): string {
  const sorted = [...shifts].sort((a, b) => a.startedAt - b.startedAt)
  let owner = sorted[0]
  for (const shift of sorted) {
    if (businessTime >= shift.startedAt) owner = shift
    else break
  }
  return owner?.id || ''
}

export function activeShift(state: DeskState): InterpreterShift | undefined {
  return state.shifts.find(shift => shift.id === state.activeShiftId)
}

/** 当前活跃交接：新班就是当前值守班、且尚未完成的交接。 */
export function activeHandover(state: DeskState): HandoverGroup | undefined {
  return state.handoverGroups.find(group => group.status === 'open' && group.toShiftId === state.activeShiftId)
}

/** 被冻结的旧班未转交段落：当前活跃交接中，旧班尚未确认转交的 cue。 */
export function heldCueIds(state: DeskState): Set<string> {
  const held = new Set<string>()
  const group = activeHandover(state)
  if (!group) return held
  for (const line of group.pendingLines) if (!line.transferred) held.add(line.cueId)
  return held
}

export function visibleCueIds(state: DeskState): string[] {
  const held = heldCueIds(state)
  return state.cues.filter(cue => !held.has(cue.id)).map(cue => cue.id)
}

function cueLinesAt(state: DeskState, cutoffAt: number): CueLineSnapshot[] {
  return state.cues
    .filter(cue => cue.businessTime <= cutoffAt && cue.status !== 'confirmed')
    .map(cue => ({
      cueId: cue.id, text: cue.text, speakerId: cue.speakerId, businessTime: cue.businessTime,
      status: cue.status, ownerShiftId: cue.ownerShiftId
    }))
}
function reminderLinesAt(state: DeskState): ReminderLineSnapshot[] {
  return state.reminders
    .filter(reminder => !reminder.acknowledged)
    .map(reminder => ({
      reminderId: reminder.id, termId: reminder.termId, cueId: reminder.cueId, target: reminder.target,
      priority: state.terms.find(term => term.id === reminder.termId)?.priority || 'normal',
      createdAt: reminder.createdAt, ownerShiftId: reminder.ownerShiftId
    }))
}
function announcementLinesAt(state: DeskState): AnnouncementLineSnapshot[] {
  return state.announcements.map(announcement => ({
    announcementId: announcement.id, level: announcement.level, text: announcement.text, visibleOnStage: announcement.visibleOnStage
  }))
}
function highUnreadCountInState(state: DeskState, group: HandoverGroup): number {
  const versionIds = new Set(group.versionIds)
  const requiredReminderIds = new Set<string>()
  for (const version of state.handoverVersions) {
    if (!versionIds.has(version.id)) continue
    version.reminderLines.filter(line => line.priority === 'high').forEach(line => requiredReminderIds.add(line.reminderId))
  }
  return [...requiredReminderIds].filter(id => state.reminders.some(reminder => reminder.id === id && !reminder.acknowledged)).length
}
function completionGate(state: DeskState, group: HandoverGroup): { transferLeft: number; highRemindersLeft: number } {
  return {
    transferLeft: group.pendingLines.filter(line => !line.transferred).length,
    highRemindersLeft: highUnreadCountInState(state, group)
  }
}
function mergePendingLine(group: HandoverGroup, versionId: string, cue: { id: string; businessTime: number }, source: PendingTransferLine['source']) {
  const existing = group.pendingLines.find(line => line.cueId === cue.id)
  if (existing) {
    if (!existing.appearedInVersionIds.includes(versionId)) existing.appearedInVersionIds.push(versionId)
    return
  }
  group.pendingLines.push({
    cueId: cue.id, businessTime: cue.businessTime, transferred: false, transferredAt: null,
    source, appearedInVersionIds: [versionId]
  })
}

export interface HandoverSubmitResult {
  status: HandoverStatus
  groupId: string
  versionId: string
  /** 与既有交接并存（双人并提或对同一开放交接再交一版）。 */
  concurrent: boolean
  /** 本版基于过期状态号提交，两版之间出现了归属变化。 */
  stale: boolean
}

/**
 * 确认交接：冻结当时可见的队列与未确认提醒（按业务时间归属），创建旧→新班次。
 * 对同一开放交接再次提交时保留两版，不覆盖原版本。
 */
export function startHandover(options: {
  fromInterpreterName: string
  toInterpreterName: string
  cutoffAt?: number
  /** 双人并提演示：基于较早的状态号提交，用于判定 stale 与归属变化。 */
  expectedRevision?: number
}): HandoverSubmitResult {
  let result: HandoverSubmitResult = { status: 'open', groupId: '', versionId: '', concurrent: false, stale: false }
  const cutoffAt = options.cutoffAt || Date.now()
  const baseRevision = get(desk).revision
  const expectedRevision = typeof options.expectedRevision === 'number' ? options.expectedRevision : baseRevision

  commit(state => {
    const existing = activeHandover(state)
    const fromShift = existing
      ? state.shifts.find(shift => shift.id === existing.fromShiftId)
      : state.shifts.find(shift => shift.id === state.activeShiftId)
    if (!fromShift) return

    let group: HandoverGroup
    let version: HandoverVersion

    if (existing) {
      // 同一交接被两人（或两次）同时提交：保留两版，共用转交流程。
      group = existing
      const toShift = state.shifts.find(shift => shift.id === group.toShiftId)
      version = {
        id: `hv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        groupId: group.id, label: `第 ${group.versionIds.length + 1} 版`,
        createdFromRevision: expectedRevision, createdAt: Date.now(), cutoffAt: group.cutoffAt,
        fromShiftId: group.fromShiftId, toShiftId: group.toShiftId,
        fromInterpreterName: options.fromInterpreterName.trim() || fromShift.interpreterName,
        toInterpreterName: options.toInterpreterName.trim() || toShift?.interpreterName || '',
        cueLines: cueLinesAt(state, group.cutoffAt),
        reminderLines: reminderLinesAt(state),
        announcementLines: announcementLinesAt(state),
        status: 'open'
      }
      state.handoverVersions.unshift(version)
      group.versionIds.push(version.id)
    } else {
      // 首次冻结：建立新班，旧班截止于 cutoffAt；新班自 cutoffAt 起值守。
      fromShift.endedAt = cutoffAt
      const toShift: InterpreterShift = {
        id: `shift-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        order: fromShift.order + 1,
        label: nextShiftLabel(state),
        interpreterName: options.toInterpreterName.trim() || `${nextShiftLabel(state)}译员`,
        startedAt: cutoffAt, endedAt: null
      }
      state.shifts.push(toShift)
      state.activeShiftId = toShift.id

      group = {
        id: `hg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        cutoffAt, fromShiftId: fromShift.id, toShiftId: toShift.id,
        versionIds: [], primaryVersionId: '', status: 'open', completedAt: null, pendingLines: []
      }
      version = {
        id: `hv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        groupId: group.id, label: '第 1 版',
        createdFromRevision: expectedRevision, createdAt: Date.now(), cutoffAt,
        fromShiftId: fromShift.id, toShiftId: toShift.id,
        fromInterpreterName: options.fromInterpreterName.trim() || fromShift.interpreterName,
        toInterpreterName: toShift.interpreterName,
        cueLines: cueLinesAt(state, cutoffAt),
        reminderLines: reminderLinesAt(state),
        announcementLines: announcementLinesAt(state),
        status: 'open'
      }
      group.versionIds.push(version.id)
      group.primaryVersionId = version.id
      state.handoverGroups.unshift(group)
      state.handoverVersions.unshift(version)
    }

    // 冻结瞬间未确认的段落进入待转交（旧班确认转交后才进入新班队列）。
    for (const line of version.cueLines) {
      const cue = state.cues.find(item => item.id === line.cueId)
      if (cue) mergePendingLine(group, version.id, cue, 'frozen')
    }
    // 若活动指针停在被冻结段落上，移到新班可见的最后一条。
    if (heldCueIds(state).has(state.activeCueId)) {
      const visible = visibleCueIds(state)
      state.activeCueId = visible.at(-1) || ''
    }

    result = {
      status: 'open', groupId: group.id, versionId: version.id,
      concurrent: group.versionIds.length > 1,
      stale: expectedRevision < baseRevision || group.versionIds.length > 1
    }
  })
  return result
}

function nextShiftLabel(state: DeskState): string {
  return `${String.fromCharCode(65 + Math.max(0, state.shifts.length))} 班`
}

/** 旧班确认转交一条段落：该段才进入新班队列。 */
export function transferLine(groupId: string, cueId: string) {
  commit(state => {
    const group = state.handoverGroups.find(item => item.id === groupId)
    if (!group) return
    const line = group.pendingLines.find(item => item.cueId === cueId)
    if (!line || line.transferred) return
    line.transferred = true
    line.transferredAt = Date.now()
    state.activeCueId = cueId
  })
}
export function transferAllLines(groupId: string) {
  commit(state => {
    const group = state.handoverGroups.find(item => item.id === groupId)
    if (!group) return
    const now = Date.now()
    group.pendingLines.forEach(line => {
      if (!line.transferred) { line.transferred = true; line.transferredAt = now }
    })
    state.activeCueId = group.pendingLines.at(-1)?.cueId || state.activeCueId
  })
}
export interface CompleteGate { transferLeft: number; highRemindersLeft: number }
export function completeHandover(groupId: string): CompleteGate | null {
  let gate: CompleteGate | null = null
  commit(state => {
    const group = state.handoverGroups.find(item => item.id === groupId)
    if (!group) return
    gate = completionGate(state, group)
    if (gate.transferLeft > 0 || gate.highRemindersLeft > 0) return
    group.status = 'completed'
    group.completedAt = Date.now()
    state.handoverVersions
      .filter(version => version.groupId === group.id)
      .forEach(version => { version.status = 'completed' })
  })
  return gate
}

export function updateActiveShiftName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  commit(state => { const shift = activeShift(state); if (shift) shift.interpreterName = trimmed })
}

/** 交接后晚到或离线补录：找到业务时间落入其截止点的交接，归入旧班待转交。 */
function attachLateArrival(state: DeskState, cue: Cue) {
  const group = state.handoverGroups.find(item =>
    item.fromShiftId === cue.ownerShiftId && item.toShiftId === state.activeShiftId)
  if (!group) return
  const already = group.pendingLines.some(line => line.cueId === cue.id)
  if (!already) {
    group.pendingLines.push({
      cueId: cue.id, businessTime: cue.businessTime, transferred: false, transferredAt: null,
      source: 'late', appearedInVersionIds: []
    })
    if (group.status === 'completed') {
      // 已完成交接后又有旧班补录：重新打开，旧班必须补转交。
      group.status = 'open'
      group.completedAt = null
      state.handoverVersions
        .filter(version => version.groupId === group.id)
        .forEach(version => { version.status = 'open' })
    }
  }
  if (heldCueIds(state).has(state.activeCueId)) {
    const visible = visibleCueIds(state)
    state.activeCueId = visible.at(-1) || ''
  }
}

export function ingestCue(text: string, options: { manual?: boolean; speakerId?: string; receivedAt?: number; businessTime?: number } = {}) {
  const trimmed = text.trim()
  if (!trimmed) return
  commit(state => {
    const existing = state.cues.filter(item => item.text !== trimmed)
    const duplicate = findDuplicate(trimmed, existing)
    const speakerId = options.speakerId || state.sessions.find(item => item.status === 'live')?.speakerId || state.speakers[0]?.id || ''
    const receivedAt = options.receivedAt || Date.now()
    const businessTime = options.businessTime || receivedAt
    const ownerShiftId = shiftOwnerAt(state.shifts, businessTime)
    const cue: Cue = {
      id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, speakerId, text: trimmed,
      businessTime, receivedAt, ownerShiftId,
      status: 'pending', manual: Boolean(options.manual), offline: !state.online,
      delaySeconds: Math.max(0, Math.round((receivedAt - businessTime) / 1000)),
      duplicateOf: duplicate?.id || null, followupText: '', tags: detectTerms(trimmed, state.terms)
    }
    state.cues.push(cue)
    if (ownerShiftId === state.activeShiftId && !activeHandover(state)) state.activeCueId = cue.id
    attachLateArrival(state, cue)
  })
}
export function updateCue(id: string, patch: Partial<Cue>) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (!cue) return
    Object.assign(cue, patch)
    // 离线补录的业务时间可被改写到更早：重算归属与待转交挂载。
    if (typeof patch.businessTime === 'number') {
      cue.ownerShiftId = shiftOwnerAt(state.shifts, cue.businessTime)
      if (cue.ownerShiftId !== state.activeShiftId) attachLateArrival(state, cue)
    }
    if (heldCueIds(state).has(id)) {
      const visible = visibleCueIds(state)
      if (!visible.includes(state.activeCueId)) state.activeCueId = visible.at(-1) || ''
    }
  })
}
export function setCueStatus(id: string, status: CueStatus) { commit(state => { const cue = state.cues.find(item => item.id === id); if (cue) cue.status = status }) }
export function deleteCue(id: string) {
  commit(state => {
    state.cues = state.cues.filter(item => item.id !== id)
    state.handoverGroups.forEach(group => {
      group.pendingLines = group.pendingLines.filter(line => line.cueId !== id)
    })
    if (state.activeCueId === id) state.activeCueId = visibleCueIds(state).at(-1) || ''
  })
}
export function clearDuplicate(id: string) { commit(state => { const cue = state.cues.find(item => item.id === id); if (cue) cue.duplicateOf = null }) }
export function sendReminder(termId: string, cueId: string) {
  commit(state => {
    const exists = state.reminders.some(item => item.termId === termId && item.cueId === cueId)
    if (exists) return
    const cue = state.cues.find(item => item.id === cueId)
    state.reminders.unshift({
      id: `rem-${Date.now()}`, termId, cueId,
      target: state.terms.find(item => item.id === termId)?.target || '',
      createdAt: Date.now(), acknowledged: false,
      ownerShiftId: cue?.ownerShiftId || state.activeShiftId
    })
  })
}
export function acknowledgeReminder(id: string) { commit(state => { const item = state.reminders.find(row => row.id === id); if (item) item.acknowledged = true }) }

export function getDelay(cue: Cue, now = Date.now()): number { return Math.max(cue.delaySeconds, Math.round((now - cue.businessTime) / 1000)) }
export function speakerName(state: DeskState, id: string): string { return state.speakers.find(item => item.id === id)?.name || '未指定' }
export function termTarget(state: DeskState, id: string): string { return state.terms.find(item => item.id === id)?.target || '' }
export function shiftLabel(state: DeskState, id: string): string {
  const shift = state.shifts.find(item => item.id === id)
  return shift ? `${shift.label} · ${shift.interpreterName}` : '未归属'
}
function detectTerms(text: string, terms: Term[]): string[] {
  const lower = text.toLowerCase()
  return terms.filter(term => lower.includes(term.source.toLowerCase()) || lower.includes(term.target)).map(term => term.target)
}
function findDuplicate(text: string, cues: Cue[]): Cue | undefined {
  return cues.find(cue => similarity(text, cue.text) >= 0.72)
}
function similarity(a: string, b: string): number {
  const grams = (value: string) => {
    const clean = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    return new Set(Array.from({ length: Math.max(0, clean.length - 1) }, (_, index) => clean.slice(index, index + 2)))
  }
  const left = grams(a), right = grams(b)
  if (!left.size || !right.size) return a.trim() === b.trim() ? 1 : 0
  let intersection = 0
  left.forEach(item => { if (right.has(item)) intersection++ })
  return intersection / (left.size + right.size - intersection)
}
