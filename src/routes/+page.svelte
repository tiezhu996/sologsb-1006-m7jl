<script lang="ts">
  import { onMount } from 'svelte'
  import Button from 'flowbite-svelte/Button.svelte'
  import {
    acknowledgeReminder, activeHandover, activeShift, addAnnouncement, addSession, addSpeaker, addTerm,
    canRedo, canUndo, clearDuplicate, completeHandover, deleteCue, desk, getDelay, heldCueIds, ingestCue,
    moveCue, publishAnnouncement, redoDesk, sendReminder, setActiveCue, setCueStatus, setFontScale,
    setLiveSimulation, setOnline, shiftLabel, speakerName, startHandover, termTarget, transferAllLines,
    transferLine, undoDesk, updateActiveShiftName, updateCue, updateSession, updateSpeaker, updateTerm
  } from '$lib/store'
  import type { Announcement, Cue, HandoverGroup, HandoverVersion, Session, TabId, Term } from '$lib/types'

  const liveLines = [
    'Cooling corridors can connect parks, schools, and shaded transit stops.',
    'The program gives every district a shared baseline for heat risk.',
    'Community health workers are collecting temperature and respiratory data together.',
    'This evidence helps us prioritize investments where vulnerability is highest.',
    'We will publish the indicator framework before the next budget cycle.'
  ]
  let tab: TabId = 'live'
  let now = Date.now()
  let manualText = ''
  let manualSpeakerId = ''
  let manualBusinessTime = ''
  let followup = ''
  let notice = ''
  let announcementText = ''
  let announcementLevel: Announcement['level'] = 'info'
  let manualInput: HTMLTextAreaElement
  let simulationIndex = 0
  let showHelp = false
  let fromName = ''
  let toName = ''
  let selectedVersionId: Record<string, string> = {}

  $: currentSession = $desk.sessions.find(item => item.status === 'live') || $desk.sessions[0]
  $: currentShift = activeShift($desk)
  $: openGroup = activeHandover($desk)
  $: heldIds = heldCueIds($desk)
  $: visibleCues = $desk.cues.filter(cue => !heldIds.has(cue.id))
  $: heldCues = $desk.cues.filter(cue => heldIds.has(cue.id))
  $: pendingTransferLines = openGroup?.pendingLines ?? []
  $: pendingTransferLeft = pendingTransferLines.filter(line => !line.transferred).length
  $: activeCue = visibleCues.find(item => item.id === $desk.activeCueId) || visibleCues.at(-1)
  $: pendingCount = visibleCues.filter(item => item.status === 'pending').length
  $: oldShiftLateCount = heldCues.filter(cue => pendingTransferLines.some(line => line.cueId === cue.id && line.source === 'late' && !line.transferred)).length
  $: offlineCount = $desk.cues.filter(item => item.offline).length
  $: lateCount = visibleCues.filter(item => getDelay(item, now) > 8 && item.status !== 'confirmed').length
  $: duplicateCount = $desk.cues.filter(item => item.duplicateOf).length
  $: highPriorityTermIds = new Set($desk.terms.filter(term => term.priority === 'high').map(term => term.id))
  $: highUnreadReminders = $desk.reminders.filter(item => !item.acknowledged && highPriorityTermIds.has(item.termId))
  $: activeSpeaker = $desk.speakers.find(item => item.id === activeCue?.speakerId)
  $: activeTerms = $desk.terms.filter(item => item.speakerId === activeCue?.speakerId || activeCue?.tags.includes(item.target))
  $: unreadReminders = $desk.reminders.filter(item => !item.acknowledged)
  $: openHandoverCount = $desk.handoverGroups.filter(group => group.status === 'open').length
  $: unpublishedCount = $desk.announcements.filter(item => !item.visibleOnStage).length
  function versionFor(group: HandoverGroup): HandoverVersion {
    const selected = selectedVersionId[group.id]
    return $desk.handoverVersions.find(version => version.id === selected)
      || $desk.handoverVersions.find(version => version.id === group.primaryVersionId)
      || $desk.handoverVersions.find(version => group.versionIds.includes(version.id)) as HandoverVersion
  }
  function groupVersions(group: HandoverGroup): HandoverVersion[] {
    return group.versionIds
      .map(id => $desk.handoverVersions.find(version => version.id === id))
      .filter((version): version is HandoverVersion => Boolean(version))
      .sort((a, b) => a.createdAt - b.createdAt)
  }
  /** 两版之间新增出现在冻结队列里的段落（多为交接后晚到/补录，按业务时间仍归旧班）。 */
  function versionDiff(group: HandoverGroup, version: HandoverVersion): { addedCueIds: Set<string>; baseCueIds: Set<string> } {
    const versions = groupVersions(group)
    const index = versions.findIndex(item => item.id === version.id)
    const base = versions[index - 1]
    const baseCueIds = new Set((base || version).cueLines.map(line => line.cueId))
    const addedCueIds = new Set(version.cueLines.filter(line => !baseCueIds.has(line.cueId)).map(line => line.cueId))
    return { addedCueIds, baseCueIds }
  }

  onMount(() => {
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine)
    const onlineHandler = () => setOnline(true)
    const offlineHandler = () => setOnline(false)
    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)
    window.addEventListener('keydown', handleKeyboard)
    const tick = window.setInterval(() => { now = Date.now() }, 1000)
    const simulate = window.setInterval(() => {
      if ($desk.liveSimulation && $desk.online) {
        ingestCue(liveLines[simulationIndex % liveLines.length])
        simulationIndex++
      }
    }, 16000)
    return () => {
      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', offlineHandler)
      window.removeEventListener('keydown', handleKeyboard)
      window.clearInterval(tick)
      window.clearInterval(simulate)
    }
  })

  function flash(message: string) {
    notice = message
    window.setTimeout(() => { if (notice === message) notice = '' }, 2800)
  }
  function selectCue(cue: Cue) {
    setActiveCue(cue.id)
    followup = ''
  }
  function confirmActive() {
    if (!activeCue) return
    setCueStatus(activeCue.id, 'confirmed')
    flash('已确认传译，队列自动前进。')
    moveCue(1)
  }
  function saveFollowup() {
    if (!activeCue || !followup.trim()) return
    updateCue(activeCue.id, { followupText: followup.trim(), status: 'followup' })
    followup = ''
    flash('遗漏内容已补充并标记为待跟进。')
  }
  function submitManual() {
    if (!manualText.trim()) return
    const businessTime = manualBusinessTime ? new Date(manualBusinessTime).getTime() : undefined
    ingestCue(manualText, { manual: true, speakerId: manualSpeakerId || activeCue?.speakerId, businessTime })
    manualText = ''
    manualBusinessTime = ''
    if (!$desk.online) flash('网络中断中，内容已暂存在本机；可填写“实际发言时间”用于离线补录归属。')
    else flash(businessTime && businessTime < Date.now() ? '离线补录已按业务时间归入对应班次。' : '手工录入已进入现场队列。')
  }
  function mergeOffline() {
    setOnline(true)
    flash('网络已恢复，离线内容已按业务时间合并并完成重复检查。')
  }
  function beginHandover() {
    const result = startHandover({ fromInterpreterName: fromName || currentShift?.interpreterName || '', toInterpreterName: toName })
    fromName = ''
    toName = ''
    if (result.concurrent) flash(`已保留第 2 版交接，两版并存，请核对归属变化。`)
    else flash('交接已确认：队列与未确认提醒已冻结，旧班段落转交后方可进入新班。')
  }
  function resubmitHandover(group: HandoverGroup) {
    const versions = groupVersions(group)
    const base = versions[0]
    const result = startHandover({
      fromInterpreterName: base.fromInterpreterName, toInterpreterName: base.toInterpreterName,
      cutoffAt: group.cutoffAt, expectedRevision: base.createdFromRevision
    })
    selectedVersionId[group.id] = result.versionId
    flash('已基于旧状态号再交一版：两版并存，新增的旧班晚到/补录段落已标出归属变化。')
  }
  function transferLineAndNotify(groupId: string, cueId: string) {
    transferLine(groupId, cueId)
    flash('旧班已确认转交，该段进入新班队列。')
  }
  function tryComplete(group: HandoverGroup) {
    const gate = completeHandover(group.id)
    if (!gate) { flash('交接完成。'); return }
    if (gate.transferLeft) flash(`还有 ${gate.transferLeft} 条旧班段落未转交，无法完成。`)
    else if (gate.highRemindersLeft) flash(`还有 ${gate.highRemindersLeft} 条未读高优先提醒未逐条交清。`)
  }
  function datetimeLocalValue(timestamp: number) {
    const d = new Date(timestamp - new Date().getTimezoneOffset() * 60000)
    return d.toISOString().slice(0, 16)
  }
  function sendTermReminder(termId: string) {
    if (!activeCue) return
    sendReminder(termId, activeCue.id)
    flash(`术语提醒已发送：${termTarget($desk, termId)}`)
  }
  function createAnnouncement() {
    addAnnouncement(announcementText, announcementLevel)
    announcementText = ''
    flash('紧急通知已保存到后台。')
  }
  function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }
  function delayClass(seconds: number) {
    if (seconds > 12) return 'bg-red-100 text-red-800 border-red-200'
    if (seconds > 8) return 'bg-amber-100 text-amber-900 border-amber-200'
    return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  }
  function statusLabel(status: Cue['status']) {
    return ({ pending: '待传', confirmed: '已确认', followup: '有补充' })[status]
  }
  function handleKeyboard(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? redoDesk() : undoDesk(); return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redoDesk(); return }
    if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); moveCue(1) }
    if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); moveCue(-1) }
    if (event.key.toLowerCase() === 'c') { event.preventDefault(); confirmActive() }
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); manualInput?.focus(); flash('手工录入已获焦，输入后按 Ctrl + Enter 提交。') }
    if (event.key.toLowerCase() === 't' && activeTerms[0]) { event.preventDefault(); sendTermReminder(activeTerms[0].id) }
    if (event.key === '?') { event.preventDefault(); showHelp = true }
    if (event.key === '+' || event.key === '=') setFontScale($desk.fontScale + 5)
    if (event.key === '-') setFontScale($desk.fontScale - 5)
  }
</script>

<svelte:head><title>会议同传提示台 · Live Cue Desk</title></svelte:head>

<a class="fixed left-2 top-2 z-[100] -translate-y-20 rounded-lg bg-white px-4 py-2 font-bold shadow focus:translate-y-0" href="#main">跳到主要内容</a>

<div class="min-h-full bg-paper text-ink" style={`font-size:${$desk.fontScale}%`}>
  <header class="sticky top-0 z-40 border-b border-slate-800 bg-ink text-white shadow-xl">
    <div class="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-3">
      <div class="mr-3 flex items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 font-black">译</div>
        <div><strong class="block tracking-tight">会议同传提示台</strong><span class="block text-[10px] uppercase tracking-[.16em] text-slate-400">Live Interpreter Cue Desk</span></div>
      </div>
      <nav class="order-3 flex w-full gap-1 overflow-x-auto rounded-xl bg-slate-800/80 p-1 lg:order-none lg:w-auto" aria-label="工作区">
        {#each [['live','现场传译'],['handovers','换班移交'],['backstage','后台准备'],['terms','术语与通知'],['offline','离线暂存']] as item}
          <button class="focus-ring whitespace-nowrap rounded-lg px-4 py-2 text-xs font-bold transition {tab === item[0] ? 'bg-white text-ink shadow' : 'text-slate-300 hover:bg-slate-700'}" aria-current={tab === item[0] ? 'page' : undefined} on:click={() => tab = item[0] as TabId}>
            {item[1]}
            {#if item[0] === 'live' && pendingCount}<span class="ml-2 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] text-white">{pendingCount}</span>{/if}
            {#if item[0] === 'handovers' && openHandoverCount}<span class="ml-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] text-slate-900">{openHandoverCount}</span>{/if}
            {#if item[0] === 'offline' && offlineCount}<span class="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">{offlineCount}</span>{/if}
          </button>
        {/each}
      </nav>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <span class="rounded-full border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-[11px] font-bold text-sky-200" title="当前值守班次">
          🎧 {currentShift?.label || '未排班'} · {currentShift?.interpreterName || '未填写译员'}
        </span>
        <span class="rounded-full border px-3 py-1.5 text-[11px] font-bold {$desk.online ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-amber-500/40 bg-amber-500/15 text-amber-300'}">
          <span class="mr-2 inline-block h-2 w-2 rounded-full {$desk.online ? 'bg-emerald-400' : 'bg-amber-400'}"></span>{$desk.online ? '现场连接正常' : '离线 · 本地暂存'}
        </span>
        <div class="flex items-center rounded-lg bg-slate-800 p-1">
          <button class="focus-ring h-7 w-7 rounded text-lg" title="缩小字号" on:click={() => setFontScale($desk.fontScale - 5)}>−</button>
          <span class="w-12 text-center text-[11px]">{$desk.fontScale}%</span>
          <button class="focus-ring h-7 w-7 rounded text-lg" title="放大字号" on:click={() => setFontScale($desk.fontScale + 5)}>＋</button>
        </div>
        <Button size="sm" color="light" on:click={() => showHelp = true}>快捷键</Button>
      </div>
    </div>
  </header>

  {#if notice}<div role="status" class="fixed right-5 top-20 z-50 rounded-xl border border-teal-200 bg-white px-4 py-3 text-sm font-bold text-teal-800 shadow-2xl">{notice}</div>{/if}

  <main id="main" class="mx-auto max-w-[1800px] p-4 lg:p-6">
    {#if tab === 'live'}
      <div class="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-[10px] font-black uppercase tracking-[.18em] text-teal-700">当前场次 · {$desk.online ? 'LIVE' : 'OFFLINE MODE'}</p>
          <h1 class="mt-1 text-2xl font-black tracking-tight lg:text-4xl">{currentSession?.title}</h1>
          <p class="mt-2 text-sm text-slate-500">{currentSession?.time} · {currentSession?.room} · {$desk.speakers.find(item => item.id === currentSession?.speakerId)?.name}</p>
        </div>
        <div class="grid grid-cols-4 gap-2 text-center">
          <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl">{pendingCount}</strong><span class="text-[10px] text-slate-500">本班待传</span></div>
          <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl text-amber-700">{lateCount}</strong><span class="text-[10px] text-slate-500">偏高延迟</span></div>
          <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl text-red-700">{duplicateCount}</strong><span class="text-[10px] text-slate-500">疑似重复</span></div>
          <div class="rounded-xl border bg-white px-4 py-2 {pendingTransferLeft ? 'ring-2 ring-amber-400' : ''}"><strong class="block text-xl text-amber-700">{pendingTransferLeft}</strong><span class="text-[10px] text-slate-500">旧班待转交</span></div>
        </div>
      </div>

      {#if openGroup}
        {@const version = versionFor(openGroup)}
        <section class="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-[10px] font-black uppercase tracking-[.18em] text-amber-700">交接进行中 · 队列已于 {formatTime(openGroup.cutoffAt)} 冻结</p>
              <h2 class="mt-1 font-black text-amber-900">{version.fromInterpreterName}（旧班）→ {version.toInterpreterName}（新班）{openGroup.versionIds.length > 1 ? ` · 共 ${openGroup.versionIds.length} 版并存` : ''}</h2>
              <p class="mt-1 text-xs text-amber-800">
                待转交 {pendingTransferLeft} 条 · 其中晚到/补录 {oldShiftLateCount} 条 ·
                未读高优先提醒 {highUnreadReminders.length} 条需逐条交清 · 后台未发布通知 {version.announcementLines.filter(line => !line.visibleOnStage).length} 条（不进现场）
              </p>
            </div>
            <Button size="sm" color="yellow" on:click={() => tab = 'handovers'}>前往换班移交</Button>
          </div>
        </section>
      {/if}

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.75fr)]">
        <div class="space-y-4">
          <section class="overflow-hidden rounded-2xl border border-teal-800 bg-[#0d3b36] text-white shadow-lg">
            <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-200">现场可见内容</span><h2 class="mt-1 font-bold">舞台字幕与紧急通知</h2></div>
              <span class="rounded-full bg-teal-600 px-2.5 py-1 text-[10px] font-black text-white">STAGE OUTPUT</span>
            </div>
            <div class="space-y-3 p-4">
              {#each $desk.announcements.filter(item => item.visibleOnStage) as item}
                <div class="rounded-xl border border-orange-300/30 bg-orange-500/15 p-3"><strong class="text-xs text-orange-200">紧急通知</strong><p class="mt-1 text-lg font-bold">{item.text}</p></div>
              {/each}
              {#each $desk.cues.filter(item => item.status === 'confirmed').slice(-2) as cue}
                <div class="rounded-xl bg-white/10 p-3">
                  <div class="mb-1 flex justify-between text-[10px] text-teal-200"><span>{speakerName($desk, cue.speakerId)}</span><span>{formatTime(cue.receivedAt)}</span></div>
                  <p class="text-base leading-relaxed lg:text-lg">{cue.text}</p>
                </div>
              {/each}
              {#if !$desk.cues.some(item => item.status === 'confirmed') && !$desk.announcements.some(item => item.visibleOnStage)}
                <p class="py-5 text-center text-sm text-teal-100/60">确认传译或发布通知后，现场可见内容将在这里出现。</p>
              {/if}
            </div>
          </section>

          <section class="rounded-2xl border bg-white shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">后台传译队列</span><h2 class="mt-1 font-bold">待确认与遗漏补充</h2></div>
              <div class="flex items-center gap-3 text-xs text-slate-500"><span>自动接入</span><button type="button" role="switch" aria-label="自动接入现场文字" aria-checked={$desk.liveSimulation} class="focus-ring h-6 w-11 rounded-full p-1 transition {$desk.liveSimulation ? 'bg-teal-600' : 'bg-slate-300'}" on:click={() => setLiveSimulation(!$desk.liveSimulation)}><span class="block h-4 w-4 rounded-full bg-white transition {$desk.liveSimulation ? 'translate-x-5' : ''}"></span></button></div>
            </div>
            <div class="max-h-[600px] space-y-2 overflow-y-auto p-3 scrollbar-thin">
              {#each visibleCues as cue, index}
                <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                <article role="button" tabindex="0" class="cue-enter cursor-pointer rounded-xl border p-3 transition {cue.id === $desk.activeCueId ? 'border-teal-600 bg-teal-50 shadow-md' : 'border-slate-200 bg-white hover:border-slate-300'}" on:click={() => selectCue(cue)} on:keydown={event => (event.key === 'Enter' || event.key === ' ') && selectCue(cue)}>
                  <div class="flex flex-wrap items-start gap-3">
                    <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-xs font-black text-white">{index + 1}</span>
                    <div class="min-w-0 flex-1">
                      <div class="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-bold">
                        <span class="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{speakerName($desk, cue.speakerId)}</span>
                        <span class="rounded-md border px-2 py-1 {delayClass(getDelay(cue, now))}">{formatTime(cue.businessTime)} · 延迟 {getDelay(cue, now)}s</span>
                        <span class="rounded-md px-2 py-1 {cue.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : cue.status === 'followup' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-800'}">{statusLabel(cue.status)}</span>
                        <span class="rounded-md bg-sky-100 px-2 py-1 text-sky-900" title="按业务时间归属">归属 {$desk.shifts.find(shift => shift.id === cue.ownerShiftId)?.label || '未归属'}</span>
                        {#if cue.offline}<span class="rounded-md bg-amber-100 px-2 py-1 text-amber-900">离线暂存</span>{/if}
                        {#if cue.manual}<span class="rounded-md bg-slate-100 px-2 py-1 text-slate-600">手工</span>{/if}
                      </div>
                      <p class="text-sm leading-6 lg:text-base">{cue.text}</p>
                      {#if cue.duplicateOf}
                        <div class="mt-2 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                          <span><strong>疑似重复：</strong>与第 {visibleCues.findIndex(item => item.id === cue.duplicateOf) + 1} 条高度相似</span>
                          <button class="font-black underline" on:click|stopPropagation={() => clearDuplicate(cue.id)}>确认非重复</button>
                        </div>
                      {/if}
                      {#if cue.followupText}<p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"><strong>补译：</strong>{cue.followupText}</p>{/if}
                      <div class="mt-2 flex flex-wrap gap-1">{#each cue.tags as tag}<span class="rounded-full bg-teal-100 px-2 py-1 text-[10px] font-bold text-teal-800">{tag}</span>{/each}</div>
                    </div>
                  </div>
                </article>
              {/each}
              {#if !visibleCues.length}<p class="py-8 text-center text-sm text-slate-400">新班队列暂无可见段落，等待旧班转交或新内容到达。</p>{/if}
            </div>
          </section>

          {#if openGroup && heldCues.length}
            <section class="rounded-2xl border border-amber-300 bg-amber-50/70 shadow-sm">
              <div class="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 px-4 py-3">
                <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-amber-700">旧班暂存 · 不进新班队列</span><h2 class="mt-1 font-bold text-amber-900">交接后晚到 / 离线补录段落</h2><p class="text-xs text-amber-800">业务时间早于冻结点，仍归旧班；旧班确认转交后才进入新班。</p></div>
                <Button size="sm" color="yellow" disabled={!pendingTransferLeft} on:click={() => transferAllLines(openGroup.id)}>全部转交</Button>
              </div>
              <div class="space-y-2 p-3">
                {#each heldCues as cue}
                  {@const line = pendingTransferLines.find(item => item.cueId === cue.id)}
                  <article class="rounded-xl border bg-white p-3 {line?.transferred ? 'border-emerald-300 opacity-70' : 'border-amber-300'}">
                    <div class="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold">
                      <span class="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{speakerName($desk, cue.speakerId)}</span>
                      <span class="rounded-md border border-amber-200 px-2 py-1 text-amber-800">业务时间 {formatTime(cue.businessTime)}</span>
                      <span class="rounded-md px-2 py-1 {line?.source === 'late' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'}">{line?.source === 'late' ? '晚到/补录归旧班' : '冻结时未确认'}</span>
                      {#if line?.transferred}<span class="rounded-md bg-emerald-100 px-2 py-1 text-emerald-800">旧班已转交</span>{/if}
                    </div>
                    <p class="text-sm leading-6">{cue.text}</p>
                    {#if line && !line.transferred}
                      <Button class="mt-2" size="xs" color="green" on:click={() => transferLineAndNotify(openGroup.id, cue.id)}>旧班确认转交 →</Button>
                    {/if}
                  </article>
                {/each}
              </div>
            </section>
          {/if}
        </div>

        <div class="space-y-4">
          <section class="rounded-2xl border bg-white p-4 shadow-sm">
            <div class="mb-3 flex items-start justify-between gap-3">
              <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-700">当前口译位</span><h2 class="mt-1 font-bold">{activeSpeaker?.name || '等待队列'}</h2><p class="text-xs text-slate-500">{activeSpeaker?.language}</p></div>
              <div class="flex gap-1"><button class="focus-ring rounded-lg border px-2 py-1 text-xs" aria-label="上一条" on:click={() => moveCue(-1)}>↑</button><button class="focus-ring rounded-lg border px-2 py-1 text-xs" aria-label="下一条" on:click={() => moveCue(1)}>↓</button></div>
            </div>
            {#if activeCue}
              <div class="rounded-xl bg-slate-50 p-3"><p class="text-sm leading-6">{activeCue.text}</p><p class="mt-2 text-[10px] text-slate-500">快捷键：J / K 移动，C 确认，T 发送首条高优先术语提醒</p></div>
              <div class="mt-3 grid grid-cols-2 gap-2"><Button color="green" on:click={confirmActive}>确认已传 <kbd class="ml-1 text-[10px]">C</kbd></Button><Button color="yellow" on:click={() => tab = 'offline'}>手工补充</Button></div>
              <label for="followup-input" class="mt-4 block text-[10px] font-black uppercase tracking-wider text-slate-500">遗漏补译</label>
              <textarea id="followup-input" class="focus-ring mt-2 w-full rounded-xl border p-3 text-sm" rows="3" bind:value={followup} placeholder="输入遗漏内容或修正术语…"></textarea>
              <Button class="mt-2 w-full" color="light" disabled={!followup.trim()} on:click={saveFollowup}>标记补充完成</Button>
            {/if}
          </section>

          <section class="rounded-2xl border bg-white p-4 shadow-sm">
            <div class="mb-3 flex items-center justify-between"><div><span class="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">术语提醒</span><h2 class="mt-1 font-bold">当前发言人术语</h2></div><span class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">{activeTerms.length}</span></div>
            <div class="space-y-2">
              {#each activeTerms as term}
                <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <div><strong class="block text-xs">{term.target}</strong><span class="text-[10px] text-slate-500">{term.source} · {term.note}</span></div>
                  <Button size="xs" color={term.priority === 'high' ? 'yellow' : 'light'} on:click={() => sendTermReminder(term.id)}>提醒</Button>
                </div>
              {/each}
            </div>
          </section>

          <section class="rounded-2xl border bg-white p-4 shadow-sm">
            <div class="mb-3 flex items-center justify-between"><h2 class="font-bold">已发送提醒</h2><span class="text-xs text-slate-500">{unreadReminders.length} 条未确认</span></div>
            <div class="max-h-52 space-y-2 overflow-y-auto">
              {#each $desk.reminders as reminder}
                <div class="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs {reminder.acknowledged ? 'bg-slate-50 text-slate-400' : 'bg-teal-50 text-teal-900'}">
                  <span><strong>{reminder.target}</strong> · {formatTime(reminder.createdAt)}</span>
                  {#if !reminder.acknowledged}<button class="font-bold underline" on:click={() => acknowledgeReminder(reminder.id)}>已看到</button>{/if}
                </div>
              {/each}
              {#if !$desk.reminders.length}<p class="py-4 text-center text-xs text-slate-400">尚未发送术语提醒。</p>{/if}
            </div>
          </section>
        </div>
      </div>
    {/if}

    {#if tab === 'handovers'}
      <div class="mb-5">
        <p class="text-[10px] font-black uppercase tracking-[.18em] text-amber-700">确认交接即冻结 · 按业务时间归属 · 旧班转交后才进新班</p>
        <h1 class="mt-1 text-3xl font-black">同传席换班移交</h1>
      </div>

      {#if !openGroup}
        <div class="grid gap-4 xl:grid-cols-[1fr_.9fr]">
          <section class="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 class="font-black">发起交接（当前：{currentShift?.label} · {currentShift?.interpreterName}）</h2>
            <p class="mt-1 text-xs text-slate-500">点击“确认交接”的瞬间，系统冻结当时现场可见队列中所有未确认段落与全部未确认提醒，并按业务时间划定归属。</p>
            <label class="mt-4 block text-xs font-bold">当前班次译员名（可直接修改）
              <input class="focus-ring mt-2 w-full rounded-xl border p-3" value={currentShift?.interpreterName || ''} on:change={event => updateActiveShiftName((event.target as HTMLInputElement).value)} />
            </label>
            <label class="mt-4 block text-xs font-bold">旧班译员（交出方，留空用当前班次名）
              <input class="focus-ring mt-2 w-full rounded-xl border p-3" bind:value={fromName} placeholder={currentShift?.interpreterName || '如：A 班译员'} />
            </label>
            <label class="mt-4 block text-xs font-bold">新班译员（接收方）
              <input class="focus-ring mt-2 w-full rounded-xl border p-3" bind:value={toName} placeholder="如：B 班译员" />
            </label>
            <Button class="mt-4 w-full" size="lg" color="yellow" on:click={beginHandover}>确认交接，冻结队列与提醒</Button>
          </section>
          <section class="rounded-2xl border bg-slate-50 p-5 text-sm leading-7 text-slate-700 shadow-sm">
            <h2 class="font-black text-slate-900">移交规则</h2>
            <ul class="mt-3 list-disc space-y-2 pl-5">
              <li><strong>冻结：</strong>交接瞬间的未确认队列、未确认术语提醒逐条定格；后台通知只登记发布状态，<strong>未发布不会提前出现在现场</strong>。</li>
              <li><strong>业务时间归属：</strong>以段落实际发言时间为准。交接后才到达、或断网恢复后补录的段落，只要业务时间早于冻结点，<strong>仍归旧班</strong>。</li>
              <li><strong>转交闸门：</strong>旧班对每一条待转交段落点“确认转交”后，该段才进入新班队列。</li>
              <li><strong>高优先提醒：</strong>所有未读高优先提醒必须逐条“交清”，普通提醒只计数不阻断。</li>
              <li><strong>双人并提：</strong>两人同时提交同一交接时保留全部版本，并标出两版间的归属变化。</li>
            </ul>
          </section>
        </div>
      {/if}

      {#if openGroup}
        {@const version = versionFor(openGroup)}
        {@const versions = groupVersions(openGroup)}
        {@const diff = versionDiff(openGroup, version)}
        {@const frozenCue = (cueId: string) => $desk.cues.find(cue => cue.id === cueId)}
        <section class="rounded-2xl border border-amber-300 bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-[10px] font-black uppercase tracking-[.18em] text-amber-700">交接冻结于 {new Date(openGroup.cutoffAt).toLocaleString('zh-CN', { hour12: false })}</p>
              <h2 class="mt-1 text-2xl font-black">{version.fromInterpreterName} → {version.toInterpreterName}</h2>
              <p class="mt-1 text-sm text-slate-500">旧班 {shiftLabel($desk, openGroup.fromShiftId)} · 新班 {shiftLabel($desk, openGroup.toShiftId)}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button size="sm" color="light" on:click={() => resubmitHandover(openGroup)}>模拟另一方并提（基于旧状态号）</Button>
              <Button size="sm" color="green" disabled={pendingTransferLeft > 0 || highUnreadReminders.length > 0} on:click={() => tryComplete(openGroup)}>完成交接</Button>
            </div>
          </div>
          {#if versions.length > 1}
            <div class="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
              <strong>检测到双人并提：</strong>已保留 {versions.length} 个版本（均未覆盖）。切换查看各版冻结内容；相对前一版新增的段落以紫色“归属变化”标出——它们是晚到/补录但按业务时间仍归旧班的内容。
              <div class="mt-2 flex flex-wrap gap-2">
                {#each versions as item, index}
                  <button class="rounded-lg border px-3 py-1.5 font-bold {item.id === version.id ? 'border-violet-600 bg-violet-600 text-white' : 'border-violet-300 bg-white'}" on:click={() => selectedVersionId[openGroup.id] = item.id}>
                    第 {index + 1} 版 · {formatTime(item.createdAt)}
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          <div class="mt-5 grid gap-4 lg:grid-cols-2">
            <!-- 冻结队列 -->
            <div class="rounded-xl border p-4">
              <h3 class="font-black">冻结队列快照（{version.cueLines.length} 条未确认）</h3>
              <div class="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {#each version.cueLines as line}
                  {@const cue = frozenCue(line.cueId)}
                  <div class="rounded-lg border p-2 text-xs {diff.addedCueIds.has(line.cueId) ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-slate-50'}">
                    <div class="flex flex-wrap items-center gap-2 font-bold">
                      <span class="rounded bg-white px-2 py-0.5">{speakerName($desk, line.speakerId)}</span>
                      <span class="text-slate-500">{formatTime(line.businessTime)}</span>
                      <span class="rounded bg-sky-100 px-2 py-0.5 text-sky-900">归 {$desk.shifts.find(shift => shift.id === line.ownerShiftId)?.label}</span>
                      {#if diff.addedCueIds.has(line.cueId)}<span class="rounded bg-violet-600 px-2 py-0.5 text-white">归属变化 · 两版间新增</span>{/if}
                    </div>
                    <p class="mt-1 leading-5">{line.text}</p>
                  </div>
                {/each}
                {#if !version.cueLines.length}<p class="py-6 text-center text-xs text-slate-400">冻结时队列已全部确认，无遗留。</p>{/if}
              </div>
            </div>

            <!-- 未确认提醒逐条交清 -->
            <div class="rounded-xl border p-4">
              <div class="flex items-center justify-between">
                <h3 class="font-black">未确认术语提醒（{version.reminderLines.length} 条）</h3>
                <span class="text-xs font-bold {highUnreadReminders.length ? 'text-red-700' : 'text-emerald-700'}">高优先未交清 {highUnreadReminders.length}</span>
              </div>
              <div class="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {#each version.reminderLines as line}
                  {@const reminder = $desk.reminders.find(item => item.id === line.reminderId)}
                  {@const acknowledged = reminder?.acknowledged}
                  <div class="flex items-center justify-between gap-3 rounded-lg border p-2 text-xs {line.priority === 'high' ? (acknowledged ? 'border-slate-200 bg-slate-50' : 'border-red-300 bg-red-50') : 'border-slate-200 bg-slate-50'}">
                    <div>
                      <p><strong>{line.target}</strong>
                        <span class="ml-1 rounded px-1.5 py-0.5 text-[10px] {line.priority === 'high' ? 'bg-red-600 text-white' : 'bg-slate-200'}">{line.priority === 'high' ? '高优先' : '常规'}</span>
                      </p>
                      <p class="mt-0.5 text-slate-500">{formatTime(line.createdAt)} · 归 {$desk.shifts.find(shift => shift.id === line.ownerShiftId)?.label}</p>
                    </div>
                    {#if !acknowledged}
                      <Button size="xs" color={line.priority === 'high' ? 'red' : 'light'} on:click={() => acknowledgeReminder(line.reminderId)}>逐条交清</Button>
                    {:else}<span class="font-bold text-emerald-700">✓ 已交清</span>{/if}
                  </div>
                {/each}
                {#if !version.reminderLines.length}<p class="py-6 text-center text-xs text-slate-400">没有未确认提醒。</p>{/if}
              </div>
            </div>

            <!-- 后台通知闸门 -->
            <div class="rounded-xl border p-4">
              <h3 class="font-black">后台通知核对（{version.announcementLines.length} 条）</h3>
              <p class="mt-1 text-xs text-slate-500">交接只记录发布状态，现场仍只显示已发布内容；未发布通知不会因换班提前上现场。</p>
              <div class="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
                {#each version.announcementLines as line}
                  {@const live = $desk.announcements.find(item => item.id === line.announcementId)}
                  {@const published = live?.visibleOnStage ?? line.visibleOnStage}
                  <div class="flex items-center justify-between gap-3 rounded-lg border p-2 text-xs {published ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-slate-50'}">
                    <span><strong>{line.text}</strong><br /><span class="text-slate-500">{line.level === 'urgent' ? '紧急' : line.level === 'warning' ? '提醒' : '信息'}</span></span>
                    <span class="shrink-0 font-bold {published ? 'text-orange-700' : 'text-slate-500'}">{published ? '现场可见' : '未发布 · 仅后台'}</span>
                  </div>
                {/each}
              </div>
            </div>

            <!-- 待转交清单 -->
            <div class="rounded-xl border p-4">
              <div class="flex items-center justify-between">
                <h3 class="font-black">旧班待转交（{pendingTransferLeft} 条未转交 / 共 {pendingTransferLines.length} 条）</h3>
                <Button size="xs" color="yellow" disabled={!pendingTransferLeft} on:click={() => transferAllLines(openGroup.id)}>全部转交</Button>
              </div>
              <div class="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
                {#each pendingTransferLines as line}
                  {@const cue = frozenCue(line.cueId)}
                  <div class="rounded-lg border p-2 text-xs {line.transferred ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}">
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-bold">{line.source === 'late' ? '晚到/补录' : '冻结未确认'} · 业务时间 {formatTime(line.businessTime)} · 归 {$desk.shifts.find(shift => shift.id === cue?.ownerShiftId)?.label}</span>
                      {#if line.transferred}<span class="font-bold text-emerald-700">✓ {line.transferredAt ? formatTime(line.transferredAt) : ''} 已转交</span>
                      {:else}<Button size="xs" color="green" on:click={() => transferLineAndNotify(openGroup.id, line.cueId)}>确认转交</Button>{/if}
                    </div>
                    <p class="mt-1 leading-5">{cue?.text || '（段落已删除）'}</p>
                  </div>
                {/each}
                {#if !pendingTransferLines.length}<p class="py-6 text-center text-xs text-slate-400">冻结时无未确认段落，也没有晚到/补录。</p>{/if}
              </div>
            </div>
          </div>

          <div class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 p-4 text-white">
            <p class="text-sm font-bold">
              {#if pendingTransferLeft || highUnreadReminders.length}
                尚不能完成：未转交 {pendingTransferLeft} 条，未交清高优先提醒 {highUnreadReminders.length} 条。
              {:else}
                全部段落已转交、高优先提醒已逐条交清，可以完成交接。
              {/if}
            </p>
            <Button color="green" disabled={pendingTransferLeft > 0 || highUnreadReminders.length > 0} on:click={() => tryComplete(openGroup)}>完成交接</Button>
          </div>
        </section>
      {/if}

      {#if $desk.handoverGroups.length}
        <section class="mt-6 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 class="font-black">交接历史（版本均保留）</h2>
          <div class="mt-3 space-y-2">
            {#each $desk.handoverGroups as group}
              {@const v = groupVersions(group)[0]}
              <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                <div>
                  <strong>{v?.fromInterpreterName} → {v?.toInterpreterName}</strong>
                  <span class="ml-2 text-xs text-slate-500">{new Date(group.cutoffAt).toLocaleString('zh-CN', { hour12: false })} · {group.versionIds.length} 版</span>
                </div>
                <span class="rounded-full px-3 py-1 text-xs font-black {group.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}">{group.status === 'completed' ? '已完成' : '进行中'}</span>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/if}

    {#if tab === 'backstage'}
      <div class="mb-5"><p class="text-[10px] font-black uppercase tracking-[.18em] text-teal-700">后台准备内容 · 不会直接显示给现场</p><h1 class="mt-1 text-3xl font-black">议程、发言人与紧急通知</h1></div>
      <div class="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
        <section class="rounded-2xl border bg-white p-4 shadow-sm">
          <div class="mb-4 flex items-center justify-between"><div><h2 class="font-black">演讲顺序</h2><p class="text-xs text-slate-500">拖动时间、状态或发言人即可更新后台准备内容。</p></div><Button size="sm" on:click={addSession}>新增场次</Button></div>
          <div class="space-y-3">
            {#each $desk.sessions.sort((a,b) => a.order - b.order) as session}
              <article class="grid gap-3 rounded-xl border p-3 md:grid-cols-[80px_1fr_190px_120px]">
                <input class="focus-ring rounded-lg border px-2 py-2 text-sm font-bold" type="time" value={session.time} on:change={event => updateSession(session.id, { time: (event.target as HTMLInputElement).value })} />
                <div><input class="focus-ring w-full rounded-lg border px-3 py-2 font-bold" value={session.title} on:change={event => updateSession(session.id, { title: (event.target as HTMLInputElement).value })} /><span class="mt-1 block text-[10px] text-slate-500">{session.room}</span></div>
                <select class="focus-ring rounded-lg border px-2" value={session.speakerId} on:change={event => updateSession(session.id, { speakerId: (event.target as HTMLSelectElement).value })}>{#each $desk.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select>
                <select class="focus-ring rounded-lg border px-2" value={session.status} on:change={event => updateSession(session.id, { status: (event.target as HTMLSelectElement).value as Session['status'] })}><option value="upcoming">未开始</option><option value="live">进行中</option><option value="done">已结束</option></select>
              </article>
            {/each}
          </div>
        </section>
        <section class="rounded-2xl border bg-white p-4 shadow-sm">
          <div class="mb-4 flex items-center justify-between"><div><h2 class="font-black">发言人</h2><p class="text-xs text-slate-500">语气、语言方向与标识颜色。</p></div><Button size="sm" color="light" on:click={addSpeaker}>新增</Button></div>
          <div class="space-y-3">
            {#each $desk.speakers as speaker}
              <div class="rounded-xl border p-3">
                <div class="flex items-center gap-2"><input class="focus-ring h-8 w-8 rounded-lg border-0 p-1" type="color" value={speaker.color} aria-label="标识颜色" on:change={event => updateSpeaker(speaker.id, { color: (event.target as HTMLInputElement).value })} /><input class="focus-ring min-w-0 flex-1 rounded-lg border px-3 py-2 font-bold" value={speaker.name} on:change={event => updateSpeaker(speaker.id, { name: (event.target as HTMLInputElement).value })} /></div>
                <input class="focus-ring mt-2 w-full rounded-lg border px-3 py-2 text-xs" value={speaker.title} on:change={event => updateSpeaker(speaker.id, { title: (event.target as HTMLInputElement).value })} />
                <input class="focus-ring mt-2 w-full rounded-lg border px-3 py-2 text-xs" value={speaker.language} on:change={event => updateSpeaker(speaker.id, { language: (event.target as HTMLInputElement).value })} />
              </div>
            {/each}
          </div>
        </section>
      </div>
    {/if}

    {#if tab === 'terms'}
      <div class="mb-5"><p class="text-[10px] font-black uppercase tracking-[.18em] text-teal-700">后台内容与现场动作</p><h1 class="mt-1 text-3xl font-black">术语表、紧急通知与发布闸门</h1></div>
      <div class="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <section class="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div class="flex items-center justify-between border-b p-4"><div><h2 class="font-black">术语表</h2><p class="text-xs text-slate-500">“发送提醒”只影响当前口译位，不发布到现场。</p></div><Button size="sm" on:click={addTerm}>新增术语</Button></div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[760px] text-left text-xs">
              <thead class="bg-slate-50 uppercase tracking-wider text-slate-500"><tr><th class="p-3">原文</th><th class="p-3">指定译法</th><th class="p-3">说明</th><th class="p-3">发言人</th><th class="p-3">优先级</th><th class="p-3"></th></tr></thead>
              <tbody>{#each $desk.terms as term}<tr class="border-t"><td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2" value={term.source} on:change={event => updateTerm(term.id, { source: (event.target as HTMLInputElement).value })} /></td><td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2 font-bold" value={term.target} on:change={event => updateTerm(term.id, { target: (event.target as HTMLInputElement).value })} /></td><td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2" value={term.note} on:change={event => updateTerm(term.id, { note: (event.target as HTMLInputElement).value })} /></td><td class="p-2"><select class="focus-ring rounded border px-2 py-2" value={term.speakerId} on:change={event => updateTerm(term.id, { speakerId: (event.target as HTMLSelectElement).value })}>{#each $desk.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select></td><td class="p-2"><select class="focus-ring rounded border px-2 py-2" value={term.priority} on:change={event => updateTerm(term.id, { priority: (event.target as HTMLSelectElement).value as Term['priority'] })}><option value="normal">常规</option><option value="high">高优先</option></select></td><td class="p-2"><Button size="xs" color="yellow" disabled={!activeCue} on:click={() => sendTermReminder(term.id)}>发送</Button></td></tr>{/each}</tbody>
            </table>
          </div>
        </section>
        <section class="rounded-2xl border bg-white p-4 shadow-sm">
          <div class="mb-4"><h2 class="font-black">紧急通知</h2><p class="text-xs text-slate-500">先保存到后台，再由管理员明确发布到现场。当前 {unpublishedCount} 条未发布，<strong>不会因换班提前上现场</strong>。</p></div>
          <select class="focus-ring w-full rounded-xl border p-3 text-sm" bind:value={announcementLevel}><option value="info">信息提示</option><option value="warning">时间提醒</option><option value="urgent">紧急通知</option></select>
          <textarea class="focus-ring mt-3 w-full rounded-xl border p-3 text-sm" rows="3" bind:value={announcementText} placeholder="输入通知内容…"></textarea>
          <Button class="mt-3 w-full" disabled={!announcementText.trim()} on:click={createAnnouncement}>保存到后台</Button>
          <div class="mt-6 space-y-3">
            {#each $desk.announcements as announcement}
              <div class="rounded-xl border p-3 {announcement.visibleOnStage ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-slate-50'}">
                <div class="flex items-center justify-between gap-3"><span class="rounded-full bg-white px-2 py-1 text-[10px] font-bold">{announcement.level === 'urgent' ? '紧急' : announcement.level === 'warning' ? '提醒' : '信息'}</span><span class="text-[10px] font-bold {announcement.visibleOnStage ? 'text-orange-700' : 'text-slate-500'}">{announcement.visibleOnStage ? '现场可见' : '仅后台'}</span></div>
                <p class="my-2 text-sm font-bold">{announcement.text}</p>
                <Button size="xs" color={announcement.visibleOnStage ? 'light' : 'yellow'} on:click={() => publishAnnouncement(announcement.id, !announcement.visibleOnStage)}>{announcement.visibleOnStage ? '撤下现场' : '发布到现场'}</Button>
              </div>
            {/each}
          </div>
        </section>
      </div>
    {/if}

    {#if tab === 'offline'}
      <div class="mb-5"><p class="text-[10px] font-black uppercase tracking-[.18em] text-amber-700">断网继续工作 · 恢复后合并</p><h1 class="mt-1 text-3xl font-black">手工录入与离线暂存</h1></div>
      <div class="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <section class="offline-hatch rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between gap-3"><div><h2 class="font-black">手工录入现场文字</h2><p class="text-xs text-slate-500">按 Ctrl + Enter 也可以提交。</p></div><span class="rounded-full px-3 py-1 text-xs font-bold {$desk.online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}">{$desk.online ? '在线写入队列' : '离线保存本机'}</span></div>
          <label class="text-xs font-bold">发言人或场次<select class="focus-ring mt-2 w-full rounded-xl border p-3" bind:value={manualSpeakerId}><option value="">跟随当前发言人</option>{#each $desk.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select></label>
          <label class="mt-4 block text-xs font-bold">实际发言时间（业务时间，可用于交接后补录归属；留空为现在）<input class="focus-ring mt-2 w-full rounded-xl border p-3" type="datetime-local" bind:value={manualBusinessTime} /></label>
          <label class="mt-4 block text-xs font-bold">现场文字<textarea bind:this={manualInput} class="focus-ring mt-2 w-full rounded-xl border p-4 text-base leading-7" rows="8" bind:value={manualText} placeholder="网络中断时，在这里继续录入…" on:keydown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitManual() }}></textarea></label>
          <Button class="mt-3 w-full" size="lg" disabled={!manualText.trim()} on:click={submitManual}>加入队列</Button>
          <div class="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><strong>暂存规则：</strong>离线条目会带“本地”标记；恢复连接后按<strong>业务时间</strong>与本机队列合并、执行相似内容检测，并归入对应班次。业务时间早于交接冻结点的补录，仍归旧班，需旧班转交后才进新班队列。</div>
        </section>
        <section class="rounded-2xl border bg-white p-5 shadow-sm">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 class="font-black">合并与冲突检查</h2><p class="text-xs text-slate-500">当前有 {offlineCount} 条离线条目，{duplicateCount} 条疑似重复。</p></div><Button disabled={$desk.online || !offlineCount} color="green" on:click={mergeOffline}>恢复连接并合并</Button></div>
          <div class="space-y-3">
            {#each $desk.cues.filter(item => item.offline) as cue}
              <article class="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4">
                <div class="flex items-center justify-between gap-3 text-[10px] font-bold text-amber-800">
                  <span>本机暂存 · 入库 {formatTime(cue.receivedAt)}</span>
                  <span class="rounded bg-sky-100 px-2 py-1 text-sky-900">归属 {$desk.shifts.find(shift => shift.id === cue.ownerShiftId)?.label}</span>
                  <span>{speakerName($desk, cue.speakerId)}</span>
                </div>
                <textarea class="focus-ring mt-3 w-full rounded-xl border border-amber-200 bg-white p-3 text-sm" rows="3" value={cue.text} on:change={event => updateCue(cue.id, { text: (event.target as HTMLTextAreaElement).value })}></textarea>
                <label class="mt-2 block text-[10px] font-bold text-amber-800">业务时间（改写后重算班次归属）
                  <input class="focus-ring mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs" type="datetime-local" value={datetimeLocalValue(cue.businessTime)} on:change={event => { const value = (event.target as HTMLInputElement).value; if (value) updateCue(cue.id, { businessTime: new Date(value).getTime() }) }} />
                </label>
                <div class="mt-2 flex justify-between"><span class="text-[10px] text-amber-800">等待恢复网络后进入现场队列</span><button class="text-xs font-bold text-red-700 underline" on:click={() => deleteCue(cue.id)}>删除暂存</button></div>
              </article>
            {/each}
            {#if !offlineCount}<div class="grid min-h-60 place-items-center rounded-xl bg-slate-50 text-center"><div><div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div><strong class="mt-3 block text-sm">没有离线暂存条目</strong><p class="mt-1 text-xs text-slate-500">可断开网络后测试手工录入与恢复合并。</p></div></div>{/if}
          </div>
        </section>
      </div>
    {/if}
  </main>

  <footer class="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 pb-6 text-[11px] text-slate-500 lg:px-6"><span>本机自动保存 · 最近更新 {new Date($desk.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span><span>后台准备内容与现场可见内容严格分离</span><div class="flex gap-2"><button class="font-bold underline disabled:opacity-40" disabled={!canUndo()} on:click={undoDesk}>撤销</button><button class="font-bold underline disabled:opacity-40" disabled={!canRedo()} on:click={redoDesk}>重做</button></div></footer>
</div>

{#if showHelp}
  <div class="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4" role="presentation" on:click={() => showHelp = false} on:keydown={event => event.key === 'Escape' && (showHelp = false)}>
    <div class="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="shortcut-title" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="flex items-start justify-between"><div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-700">Keyboard First</span><h2 id="shortcut-title" class="mt-1 text-xl font-black">键盘操作</h2></div><button class="rounded-lg px-2 py-1 text-xl" aria-label="关闭" on:click={() => showHelp = false}>×</button></div>
      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        {#each [['J / ↓','下一条队列'],['K / ↑','上一条队列'],['C','确认已传并前进'],['N','聚焦手工录入'],['T','发送当前高优先术语'],['+ / −','调整界面字号'],['Ctrl + Z','撤销'],['Ctrl + Shift + Z','重做']] as shortcut}
          <div class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"><kbd class="rounded-md border bg-white px-2 py-1 text-xs font-black">{shortcut[0]}</kbd><span class="text-xs text-slate-600">{shortcut[1]}</span></div>
        {/each}
      </div>
    </div>
  </div>
{/if}
