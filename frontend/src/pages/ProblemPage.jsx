import { useState, useEffect, useCallback, useMemo } from 'react'
import { Play, Send, Loader, ArrowLeft, Clock, MemoryStick, Bookmark, NotebookPen, Lightbulb, Star } from 'lucide-react'
import CodeEditor from '../components/CodeEditor'
import OutputPanel from '../components/OutputPanel'
import DiscussionPanel from '../components/DiscussionPanel'
import TestCasesPanel from '../components/TestCasesPanel'
import { api } from '../utils/api'
import { DEFAULT_BOILERPLATE_BY_LANGUAGE } from '../data/practiceQuestions'
import { recordSolveToday } from './CalendarHeatmap'

const STORAGE_LANG_KEY = 'skillbite_coding_lang'
const codeKey = (id, lang) => `skillbite_code_${id}_${lang}`
const PROBLEM_PREFS_KEY = 'skillbite_problem_prefs' // { [storageId]: { note, bookmarked, revision, status } }

const JUDGE_TEMPLATES = {
  java:   `import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // your code here\n    }\n}`,
  python: `import sys\ninput = sys.stdin.readline\n\n# your code here\n`,
  cpp:    `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    // your code here\n    return 0;\n}`,
  c:      `#include <stdio.h>\n\nint main(void) {\n    // your code here\n    return 0;\n}`,
}

function getTemplate(language) {
  return JUDGE_TEMPLATES[language] ?? DEFAULT_BOILERPLATE_BY_LANGUAGE[language] ?? '// your code here\n'
}

function loadSavedCode(id, language) {
  try { return localStorage.getItem(codeKey(id, language)) || null } catch { return null }
}

function persistCode(id, language, code) {
  try { localStorage.setItem(codeKey(id, language), code) } catch (e) { /* ignore */ }
}

function loadPrefs(storageId) {
  try {
    const all = JSON.parse(localStorage.getItem(PROBLEM_PREFS_KEY) || '{}')
    return all[storageId] || { note: '', bookmarked: false, revision: false, status: 'unsolved' }
  } catch {
    return { note: '', bookmarked: false, revision: false, status: 'unsolved' }
  }
}
function savePrefs(storageId, prefs) {
  try {
    const all = JSON.parse(localStorage.getItem(PROBLEM_PREFS_KEY) || '{}')
    localStorage.setItem(PROBLEM_PREFS_KEY, JSON.stringify({ ...all, [storageId]: prefs }))
  } catch { /* ignore */ }
}

// ── Piston API (for local practice problems) ─────────────────────────────────
async function runViaPiston(language, code, stdin) {
  const map = {
    java:       { language: 'java',   version: '15.0.2', name: 'Main.java' },
    python:     { language: 'python', version: '3.10.0', name: 'main.py' },
    cpp:        { language: 'c++',    version: '10.2.0', name: 'main.cpp' },
    c:          { language: 'c',      version: '10.2.0', name: 'main.c' },
    javascript: { language: 'javascript', version: '18.15.0', name: 'main.js' },
    typescript: { language: 'typescript', version: '5.0.3',   name: 'main.ts' },
    go:         { language: 'go',     version: '1.16.2', name: 'main.go' },
    rust:       { language: 'rust',   version: '1.50.0', name: 'main.rs' },
    kotlin:     { language: 'kotlin', version: '1.6.20', name: 'main.kt' },
  }
  const m = map[language] || { language, version: '*', name: `main.${language}` }
  try {
    const res = await fetch('https://emkc.org/api/v2/piston/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: m.language, version: m.version,
        files: [{ name: m.name, content: code }],
        stdin: stdin ?? '',
      }),
    })
    const data = await res.json()
    if (!data.run) return { ok: false, stdout: '', stderr: data.message || 'Unknown error' }
    const err = [data.compile?.stderr, data.run.stderr].filter(Boolean).join('\n').trim()
    const ok = (data.compile == null || data.compile.code === 0) && data.run.code === 0
    return { ok, stdout: data.run.stdout ?? '', stderr: err || (!ok ? `Exit code ${data.run.code}` : '') }
  } catch (e) {
    return { ok: false, stdout: '', stderr: String(e.message) + ' (network error)' }
  }
}

function normalize(s) {
  return (s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
}

// ── ProblemPage ───────────────────────────────────────────────────────────────
export default function ProblemPage({ problemId, localQuestion, topicTitle, language: inheritedLang, onBack }) {
  const initLang = inheritedLang
    || (() => { try { return localStorage.getItem(STORAGE_LANG_KEY) || 'java' } catch { return 'java' } })()

  // Unique key for code storage — use problemId for backend, title slug for local
  const storageId = problemId ? `backend_${problemId}` : `local_${(localQuestion?.title || 'q').replace(/\s+/g, '_')}`

  const [problem, setProblem]     = useState(null)
  const [fetching, setFetching]   = useState(!!problemId)
  const [language, setLanguage]   = useState(initLang)
  const [code, setCode]           = useState(() => loadSavedCode(storageId, initLang) || getTemplate(initLang))
  const [result, setResult]       = useState(null)
  const [running, setRunning]     = useState(false)
  const [runMode, setRunMode]     = useState('run')
  const [activeTab, setActiveTab] = useState('description')
  const [leftWidth, setLeftWidth] = useState(42)
  const [dragging, setDragging]   = useState(false)
  const [prefs, setPrefs]         = useState(() => loadPrefs(storageId))
  const [noteOpen, setNoteOpen]   = useState(false)
  const [hintStep, setHintStep]   = useState(0)
  const [panelTab, setPanelTab]   = useState('testcases') // 'testcases' | 'console'
  const [caseRun, setCaseRun]     = useState(null) // { stdout, stderr }

  // Fetch backend problem
  useEffect(() => {
    if (!problemId) { setFetching(false); return }
    setFetching(true)
    api.getProblem(problemId)
      .then(p => { setProblem(p); setFetching(false) })
      .catch(() => setFetching(false))
  }, [problemId])

  const handleCodeChange = useCallback((v) => {
    setCode(v)
    persistCode(storageId, language, v)
  }, [storageId, language])

  function handleLangChange(lang) {
    setLanguage(lang)
    localStorage.setItem(STORAGE_LANG_KEY, lang)
    setCode(loadSavedCode(storageId, lang) || getTemplate(lang))
    setResult(null)
  }

  // ── Run ───────────────────────────────────────────────────────────────────
  async function handleRun() {
    setRunning(true); setRunMode('run'); setResult(null)
    try {
      if (problemId) {
        // Backend judge — run public test cases only
        const res = await api.runCode(code, language, problemId)
        setResult(res)
        setPanelTab('console')
      } else {
        // Local practice — run via Piston against sample input
        const stdin = localQuestion?.input ?? ''
        const res = await runViaPiston(language, code, stdin)
        const expected = normalize(localQuestion?.output ?? '')
        const actual   = normalize(res.stdout)
        const passed   = res.ok && actual === expected
        setResult({
          verdict: passed ? 'AC' : res.stderr ? 'RE' : 'WA',
          totalTimeMs: 0,
          compileError: res.stderr || null,
          results: [{
            index: 1,
            input: stdin,
            expectedOutput: localQuestion?.output ?? '',
            actualOutput: res.stdout,
            status: passed ? 'PASS' : res.stderr ? 'RE' : 'FAIL',
            executionTimeMs: 0,
            hidden: false,
          }],
        })
        setPanelTab('console')
      }
    } catch (e) {
      setResult({ verdict: 'RE', compileError: e.message, results: [] })
      setPanelTab('console')
    } finally {
      setRunning(false)
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setRunning(true); setRunMode('submit'); setResult(null)
    try {
      if (problemId) {
        const res = await api.submitCode(code, language, problemId)
        setResult(res)
        setPanelTab('console')
        if (res?.verdict === 'AC') {
          recordSolveToday()
          const next = { ...prefs, status: 'solved' }
          setPrefs(next); savePrefs(storageId, next)
        } else {
          const next = { ...prefs, status: prefs.status === 'unsolved' ? 'attempted' : prefs.status }
          setPrefs(next); savePrefs(storageId, next)
        }
      } else {
        // Local: same as run for practice problems
        await handleRun()
        setRunning(false)
        return
      }
    } catch (e) {
      setResult({ verdict: 'RE', compileError: e.message, results: [] })
    } finally {
      setRunning(false)
    }
  }

  // ── Drag divider ──────────────────────────────────────────────────────────
  function onDividerMouseDown(e) { e.preventDefault(); setDragging(true) }
  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => setLeftWidth(Math.min(70, Math.max(25, (e.clientX / window.innerWidth) * 100)))
    const onUp   = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging])

  const supportedLangs = problemId
    ? Object.keys(JUDGE_TEMPLATES)
    : Object.keys(DEFAULT_BOILERPLATE_BY_LANGUAGE)

  const displayTitle = fetching ? 'Loading...'
    : problem?.title ?? localQuestion?.title ?? 'Problem'

  const companies = problem?.companies ?? []
  const tags = problem?.tags ?? []
  const hints = problem?.hints ?? []
  const inputFields = problem?.inputFields ?? []

  const defaultCases = useMemo(() => {
    // Convert backend public test cases to a few default cases
    if (!problem?.testCases?.length) return []
    return problem.testCases.slice(0, 3).map((tc, idx) => ({
      id: `case_${tc.id ?? idx}`,
      name: `Case ${idx + 1}`,
      inputFields: (inputFields || []).reduce((acc, f) => ({ ...acc, [f.name]: '' }), {}),
      expectedOutput: tc.expectedOutput ?? '',
      stdin: tc.input ?? '',
      isCustom: false,
    }))
  }, [problem?.testCases, inputFields])

  async function handleRunSingleCase(activeCase) {
    // For backend problems we currently only support public judge-run (all public cases)
    // but we can still run *one* case locally via Piston for quick feedback.
    const stdin = activeCase?.stdin ?? buildStdinFromFields(activeCase?.inputFields, inputFields)
    if (!stdin && !problemId) return
    setRunning(true)
    setCaseRun(null)
    try {
      const res = await runViaPiston(language, code, stdin)
      setCaseRun({ stdout: res.stdout, stderr: res.stderr })
    } finally {
      setRunning(false)
    }
  }

  const difficulty = problem?.difficulty ?? localQuestion?.difficulty ?? 'Easy'
  const diffPill = difficulty === 'Hard' ? 'border-red-800 text-red-400' : difficulty === 'Medium' ? 'border-yellow-800 text-yellow-400' : 'border-green-800 text-green-400'

  return (
    <div className="flex flex-col h-screen bg-[#0d0d0d] text-gray-100 overflow-hidden">

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#111111] border-b border-gray-800 shrink-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm shrink-0 transition-colors"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <span className="text-gray-700">|</span>
          {topicTitle && <span className="text-xs text-gray-500 shrink-0 truncate max-w-[120px]">{topicTitle}</span>}
          {topicTitle && <span className="text-gray-700">›</span>}
          <span className="font-semibold text-sm truncate text-white">{displayTitle}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {problemId && (
            <div className="hidden md:flex items-center gap-2 mr-2">
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${diffPill}`}>{difficulty}</span>
              {!!companies.length && (
                <div className="flex items-center gap-1 max-w-[260px] overflow-hidden">
                  {companies.slice(0, 4).map(c => (
                    <span key={c} className="text-[10px] px-2 py-0.5 rounded-full border border-gray-800 bg-gray-900/60 text-gray-300">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => { const next = { ...prefs, bookmarked: !prefs.bookmarked }; setPrefs(next); savePrefs(storageId, next) }}
            className="p-2 rounded-lg border border-gray-800 bg-[#0f0f0f] hover:bg-[#161616] transition-colors"
            title="Bookmark"
          >
            <Bookmark size={14} className={prefs.bookmarked ? 'text-yellow-400' : 'text-gray-500'} />
          </button>

          <button
            onClick={() => { const next = { ...prefs, revision: !prefs.revision }; setPrefs(next); savePrefs(storageId, next) }}
            className="p-2 rounded-lg border border-gray-800 bg-[#0f0f0f] hover:bg-[#161616] transition-colors"
            title="Mark for revision"
          >
            <Star size={14} className={prefs.revision ? 'text-orange-400' : 'text-gray-500'} />
          </button>

          <button
            onClick={() => setNoteOpen(true)}
            className="p-2 rounded-lg border border-gray-800 bg-[#0f0f0f] hover:bg-[#161616] transition-colors"
            title="Notes"
          >
            <NotebookPen size={14} className={prefs.note?.trim() ? 'text-blue-400' : 'text-gray-500'} />
          </button>

          <button
            onClick={() => setHintStep((s) => Math.min((hints?.length || 0), s + 1))}
            disabled={!hints?.length}
            className="p-2 rounded-lg border border-gray-800 bg-[#0f0f0f] hover:bg-[#161616] transition-colors disabled:opacity-40"
            title="Show hint"
          >
            <Lightbulb size={14} className="text-gray-400" />
          </button>

          <select
            value={language}
            onChange={e => handleLangChange(e.target.value)}
            className="bg-[#1e1e1e] border border-gray-700 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 text-gray-200"
          >
            {supportedLangs.map(l => (
              <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
            ))}
          </select>

          <button
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2a2a2a] hover:bg-[#333] border border-gray-700 rounded text-sm font-medium disabled:opacity-40 transition-colors"
          >
            {running && runMode === 'run' ? <Loader size={13} className="animate-spin" /> : <Play size={13} className="text-green-400" />}
            Run
          </button>

          <button
            onClick={handleSubmit}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-sm font-medium disabled:opacity-40 transition-colors"
          >
            {running && runMode === 'submit' ? <Loader size={13} className="animate-spin" /> : <Send size={13} />}
            Submit
          </button>
        </div>
      </div>

      {/* Split layout */}
      <div className="flex flex-1 overflow-hidden" style={{ cursor: dragging ? 'col-resize' : 'default' }}>

        {/* LEFT: description */}
        <div className="flex flex-col border-r border-gray-800 overflow-hidden shrink-0" style={{ width: `${leftWidth}%` }}>
          <div className="flex border-b border-gray-800 bg-[#111111] shrink-0">
            {['description', 'editorial', 'solutions', 'submissions', 'discussion'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-xs font-medium capitalize transition-colors ${
                  activeTab === tab ? 'border-b-2 border-blue-500 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === 'description' && (
              <>
                <ProblemDescription problem={problem} localQuestion={localQuestion} loading={fetching} />
                {!!hintStep && !!hints?.length && (
                  <div className="mt-6 bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Hints</p>
                    <div className="space-y-2 text-sm text-gray-300">
                      {hints.slice(0, hintStep).map((h, i) => (
                        <div key={i} className="bg-gray-950/40 border border-gray-800 rounded-lg p-3">
                          <span className="text-gray-500 text-xs font-semibold mr-2">Hint {i + 1}</span>
                          {h}
                        </div>
                      ))}
                    </div>
                    {hintStep < hints.length && (
                      <button
                        onClick={() => setHintStep(s => Math.min(hints.length, s + 1))}
                        className="mt-3 text-xs text-blue-400 hover:text-blue-300"
                      >
                        Show next hint
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            {activeTab === 'editorial' && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Editorial</h3>
                <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                  {problem?.editorial || 'Editorial not available for this problem yet.'}
                </p>
              </div>
            )}
            {activeTab === 'solutions' && (
              <SolutionsPanel solutions={problem?.solutions} />
            )}
            {activeTab === 'submissions' && <SubmissionHistory />}
            {activeTab === 'discussion' && (
              problemId
                ? <DiscussionPanel problemId={problemId} />
                : <div className="text-gray-500 text-sm">Discussion is available for backend problems.</div>
            )}
          </div>
        </div>

        {/* Drag divider */}
        <div
          onMouseDown={onDividerMouseDown}
          className="w-1 bg-gray-800 hover:bg-blue-600 cursor-col-resize shrink-0 transition-colors"
        />

        {/* RIGHT: editor + console */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <div className="flex-1 overflow-hidden">
            <CodeEditor language={language} code={code} onChange={handleCodeChange} height="100%" />
          </div>

          <div className="h-60 shrink-0 border-t border-gray-800 bg-[#111111] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
              <div className="flex items-center gap-1">
                {['testcases', 'console'].map(t => (
                  <button
                    key={t}
                    onClick={() => setPanelTab(t)}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                      panelTab === t ? 'bg-gray-900/60 border border-gray-800 rounded-lg text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {t === 'testcases' ? 'Test Cases' : 'Console'}
                  </button>
                ))}
              </div>
              {result && panelTab === 'console' && (
                <button onClick={() => setResult(null)} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                  Clear
                </button>
              )}
              {panelTab === 'testcases' && (
                <button onClick={() => setCaseRun(null)} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                  Clear output
                </button>
              )}
            </div>

            <div className="flex-1 overflow-hidden">
              {panelTab === 'console' ? (
                <div className="h-full overflow-y-auto p-3">
                  <OutputPanel result={result} loading={running} mode={runMode} />
                </div>
              ) : (
                <TestCasesPanel
                  inputFields={inputFields}
                  defaultCases={defaultCases}
                  onRunCase={(tc) => handleRunSingleCase(tc)}
                  running={running}
                  activeResult={caseRun}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {noteOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-md">
            <h3 className="font-semibold text-white mb-3 text-sm">Personal Notes</h3>
            <textarea
              value={prefs.note || ''}
              onChange={(e) => {
                const next = { ...prefs, note: e.target.value }
                setPrefs(next); savePrefs(storageId, next)
              }}
              rows={7}
              placeholder="Write your approach, edge cases, reminders..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 resize-none focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setNoteOpen(false)}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm py-2 rounded-lg font-medium"
              >
                Done
              </button>
              <button
                onClick={() => { const next = { ...prefs, note: '' }; setPrefs(next); savePrefs(storageId, next) }}
                className="px-4 text-gray-400 hover:text-white text-sm"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function buildStdinFromFields(fieldValues, inputFields) {
  if (!fieldValues || !inputFields?.length) return ''
  // Very simple: join each named input on new lines
  return inputFields.map(f => (fieldValues[f.name] ?? '').toString().trim()).join('\n').trim() + '\n'
}

function SolutionsPanel({ solutions }) {
  const items = Array.isArray(solutions) ? solutions : []
  const [idx, setIdx] = useState(0)
  const active = items[idx]

  if (!items.length) {
    return <div className="text-gray-500 text-sm">No solutions available yet.</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {items.map((s, i) => (
          <button
            key={`${s.language}-${i}`}
            onClick={() => setIdx(i)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              i === idx
                ? 'border-blue-600 bg-blue-900/20 text-blue-300'
                : 'border-gray-800 bg-gray-900/40 text-gray-400 hover:text-gray-200'
            }`}
          >
            {s.language}
          </button>
        ))}
      </div>
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <p className="text-sm font-semibold text-white">{active?.title || 'Solution'}</p>
        {active?.explanation && (
          <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{active.explanation}</p>
        )}
        {active?.code && (
          <pre className="mt-3 text-xs text-gray-200 whitespace-pre-wrap font-mono bg-gray-950/40 border border-gray-800 p-3 rounded-lg">
            {active.code}
          </pre>
        )}
      </div>
    </div>
  )
}

// ── Problem description ───────────────────────────────────────────────────────
function ProblemDescription({ problem, localQuestion, loading }) {
  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-6 bg-gray-800 rounded w-3/4" />
        <div className="h-4 bg-gray-800 rounded w-full" />
        <div className="h-4 bg-gray-800 rounded w-5/6" />
      </div>
    )
  }

  // Backend problem
  if (problem) {
    return (
      <div className="space-y-5 text-sm">
        <h2 className="text-xl font-bold text-white">{problem.title}</h2>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1 text-gray-400"><Clock size={11} /> {problem.timeLimitSeconds}s</span>
          <span className="flex items-center gap-1 text-gray-400"><MemoryStick size={11} /> {problem.memoryLimitMb}MB</span>
        </div>
        <p className="text-gray-300 whitespace-pre-wrap leading-relaxed">{problem.description}</p>
        {problem.constraints && (
          <div>
            <p className="font-semibold text-gray-200 mb-2 text-xs uppercase tracking-wider">Constraints</p>
            <pre className="text-gray-400 text-xs whitespace-pre-wrap font-mono bg-gray-900/60 border border-gray-800 p-3 rounded-lg">{problem.constraints}</pre>
          </div>
        )}
        {problem.sampleInput && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="font-semibold text-gray-200 mb-2 text-xs uppercase tracking-wider">Sample Input</p>
              <pre className="bg-gray-900/60 border border-gray-800 p-3 rounded-lg text-xs font-mono text-gray-300 whitespace-pre-wrap">{problem.sampleInput}</pre>
            </div>
            <div>
              <p className="font-semibold text-gray-200 mb-2 text-xs uppercase tracking-wider">Sample Output</p>
              <pre className="bg-gray-900/60 border border-gray-800 p-3 rounded-lg text-xs font-mono text-gray-300 whitespace-pre-wrap">{problem.sampleOutput}</pre>
            </div>
          </div>
        )}
        {problem.testCases?.length > 0 && (
          <div>
            <p className="font-semibold text-gray-200 mb-2 text-xs uppercase tracking-wider">
              Test Cases ({problem.testCases.length} public)
            </p>
            <div className="space-y-2">
              {problem.testCases.map((tc, i) => (
                <div key={tc.id} className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 text-xs font-mono">
                  <span className="text-gray-500">Case {i + 1}: </span>
                  <span className="text-gray-400">in: </span><span className="text-gray-200">{tc.input}</span>
                  <span className="text-gray-400 ml-2">→ </span><span className="text-green-400">{tc.expectedOutput}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Local practice problem
  if (localQuestion) {
    return (
      <div className="space-y-5 text-sm">
        <h2 className="text-xl font-bold text-white">{localQuestion.title}</h2>
        <span className="inline-block text-xs px-2 py-0.5 rounded-full border border-gray-700 text-gray-400">
          {localQuestion.difficulty || 'Easy'}
        </span>
        <p className="text-gray-300 leading-relaxed">{localQuestion.fullDescription || localQuestion.description}</p>
        {localQuestion.constraints && (
          <div>
            <p className="font-semibold text-gray-200 mb-2 text-xs uppercase tracking-wider">Constraints</p>
            <p className="text-gray-400 text-xs">{localQuestion.constraints}</p>
          </div>
        )}
        {localQuestion.input != null && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="font-semibold text-gray-200 mb-2 text-xs uppercase tracking-wider">Example Input</p>
              <pre className="bg-gray-900/60 border border-gray-800 p-3 rounded-lg text-xs font-mono text-gray-300 whitespace-pre-wrap">{localQuestion.input}</pre>
            </div>
            <div>
              <p className="font-semibold text-gray-200 mb-2 text-xs uppercase tracking-wider">Example Output</p>
              <pre className="bg-gray-900/60 border border-gray-800 p-3 rounded-lg text-xs font-mono text-green-400 whitespace-pre-wrap">{localQuestion.output}</pre>
            </div>
          </div>
        )}
      </div>
    )
  }

  return <div className="text-gray-500 text-sm text-center py-8">Problem not found or backend is offline.</div>
}

// ── Submission history ────────────────────────────────────────────────────────
function SubmissionHistory() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getSubmissions()
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false))
  }, [])

  const VERDICT_STYLE = {
    AC:            'text-green-400 bg-green-900/20 border-green-800',
    WA:            'text-red-400 bg-red-900/20 border-red-800',
    TLE:           'text-yellow-400 bg-yellow-900/20 border-yellow-800',
    RE:            'text-orange-400 bg-orange-900/20 border-orange-800',
    COMPILE_ERROR: 'text-pink-400 bg-pink-900/20 border-pink-800',
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading submissions...</div>
  if (!history.length) return <div className="text-gray-500 text-sm">No submissions yet.</div>

  return (
    <div className="space-y-2">
      {history.map(s => (
        <div key={s.id} className="bg-gray-900/40 border border-gray-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-300 text-xs font-medium truncate">{s.problemTitle}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded border ${VERDICT_STYLE[s.verdict] ?? 'text-gray-400 border-gray-700'}`}>
              {s.verdict}
            </span>
          </div>
          <div className="flex gap-3 text-xs text-gray-600">
            <span>{s.language}</span>
            <span>{s.executionTimeMs}ms</span>
            <span>{new Date(s.submittedAt).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
