import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getFreePort, startNavind } from './support/spawn-server.js'
import { createTempDir, removeTempDir } from './support/test-helpers.js'

describe('navind setup process & SQLite restart integration', () => {
  it('drives discover-plan-diff-approve-apply-verify across a real process restart with idempotent resume and Tier 3 safety', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin-setup-process.db')
    const bootstrapEmail = 'alice@example.com'
    const bootstrapPassword = 'correct-horse-battery-staple-1234'

    const env = {
      NAVIN_DATABASE_PATH: databasePath,
      NAVIN_CONTROL_BOOTSTRAP_EMAIL: bootstrapEmail,
      NAVIN_CONTROL_BOOTSTRAP_PASSWORD: bootstrapPassword,
      NAVIN_LOG_LEVEL: 'warn',
    }

    let sessionId = ''

    // Phase 1: First process run — create session, discover, plan, diff, approve, apply
    const port1 = await getFreePort()
    const proc1 = await startNavind({ port: port1, env })

    try {
      const baseUrl1 = `http://127.0.0.1:${port1}`

      // 1. Authenticate to control surface
      const loginRes = await fetch(`${baseUrl1}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-navin-surface': 'cli' },
        body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
      })
      expect(loginRes.status).toBe(200)
      const { token } = (await loginRes.json()) as { token: string }
      expect(token).toBeDefined()

      const authHeaders = {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-navin-surface': 'cli',
      }

      // 2. Create setup session
      const createRes = await fetch(`${baseUrl1}/api/v1/setup/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ title: 'Loopback Process Test' }),
      })
      expect(createRes.status).toBe(201)
      const session = (await createRes.json()) as {
        id: string
        title: string
        currentStage: string
        status: string
        blocks: { id: string; kind: string; status: string }[]
      }
      expect(session.id).toMatch(/^set_[a-f0-9]{32}$/)
      sessionId = session.id

      // 3. Step discover
      const discRes = await fetch(`${baseUrl1}/api/v1/setup/sessions/${sessionId}/discover`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      })
      expect(discRes.status).toBe(200)
      const discBody = (await discRes.json()) as {
        blocks: { kind: string; status: string }[]
      }
      expect(discBody.blocks.find((b) => b.kind === 'discovery')?.status).toBe('passed')

      // 4. Step plan
      const planRes = await fetch(`${baseUrl1}/api/v1/setup/sessions/${sessionId}/plan`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      })
      expect(planRes.status).toBe(200)

      // 5. Step diff
      const diffRes = await fetch(`${baseUrl1}/api/v1/setup/sessions/${sessionId}/diff`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      })
      expect(diffRes.status).toBe(200)

      // 6. Step approve
      const approveRes = await fetch(`${baseUrl1}/api/v1/setup/sessions/${sessionId}/approve`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      })
      expect(approveRes.status).toBe(200)

      // 7. Step apply
      const applyRes = await fetch(`${baseUrl1}/api/v1/setup/sessions/${sessionId}/apply`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      })
      expect(applyRes.status).toBe(200)
      const applyBody = (await applyRes.json()) as {
        blocks: { kind: string; status: string }[]
      }
      expect(applyBody.blocks.find((b) => b.kind === 'action')?.status).toBe('passed')

      // Stop first process cleanly
      const exit1 = await proc1.shutdown()
      expect(exit1.code).toBe(0)
    } finally {
      proc1.kill()
    }

    // Phase 2: Second process run on same SQLite database (Simulate Daemon Restart)
    const port2 = await getFreePort()
    const proc2 = await startNavind({ port: port2, env })

    try {
      const baseUrl2 = `http://127.0.0.1:${port2}`

      // Authenticate to new process
      const loginRes2 = await fetch(`${baseUrl2}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-navin-surface': 'cli' },
        body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
      })
      const { token: token2 } = (await loginRes2.json()) as { token: string }
      const authHeaders2 = {
        'content-type': 'application/json',
        authorization: `Bearer ${token2}`,
        'x-navin-surface': 'cli',
      }

      // 8. Fetch session after restart — same IDs, same passed blocks
      const getRes = await fetch(`${baseUrl2}/api/v1/setup/sessions/${sessionId}`, {
        headers: authHeaders2,
      })
      expect(getRes.status).toBe(200)
      const recoveredSession = (await getRes.json()) as {
        id: string
        title: string
        blocks: { id: string; kind: string; status: string }[]
      }
      expect(recoveredSession.id).toBe(sessionId)
      expect(recoveredSession.title).toBe('Loopback Process Test')
      expect(recoveredSession.blocks.find((b) => b.kind === 'action')?.status).toBe('passed')
      expect(recoveredSession.blocks.find((b) => b.kind === 'verification')?.status).toBe('pending')

      // 9. Resume is idempotent
      const resumeRes = await fetch(`${baseUrl2}/api/v1/setup/sessions/${sessionId}/resume`, {
        method: 'POST',
        headers: authHeaders2,
        body: JSON.stringify({}),
      })
      expect(resumeRes.status).toBe(200)

      // 10. Complete remaining verify step
      const verifyRes = await fetch(`${baseUrl2}/api/v1/setup/sessions/${sessionId}/verify`, {
        method: 'POST',
        headers: authHeaders2,
        body: JSON.stringify({}),
      })
      expect(verifyRes.status).toBe(200)
      const verifyBody = (await verifyRes.json()) as {
        status: string
        currentStage: string
        blocks: { kind: string; status: string }[]
      }
      expect(verifyBody.status).toBe('completed')
      expect(verifyBody.currentStage).toBe('READY')
      expect(verifyBody.blocks.find((b) => b.kind === 'verification')?.status).toBe('passed')

      // 11. SSE stream check: historical replay, live-delivery, and reconnect
      const liveSessionRes = await fetch(`${baseUrl2}/api/v1/setup/sessions`, {
        method: 'POST',
        headers: authHeaders2,
        body: JSON.stringify({ title: 'SSE Live Stream Test' }),
      })
      const liveSession = (await liveSessionRes.json()) as { id: string }

      // Connect SSE stream BEFORE triggering command to test live delivery
      const liveSseRes = await fetch(`${baseUrl2}/api/v1/setup/sessions/${liveSession.id}/events`, {
        headers: { ...authHeaders2, accept: 'text/event-stream' },
      })
      expect(liveSseRes.status).toBe(200)
      expect(liveSseRes.headers.get('content-type')).toContain('text/event-stream')
      const liveReader = liveSseRes.body!.getReader()
      const decoder = new TextDecoder()

      // Trigger discover command while SSE stream is open
      const discRes = await fetch(`${baseUrl2}/api/v1/setup/sessions/${liveSession.id}/discover`, {
        method: 'POST',
        headers: authHeaders2,
        body: JSON.stringify({}),
      })
      expect(discRes.status).toBe(200)

      // Read live delivery chunks
      let liveText = ''
      while (!liveText.includes('setup.session.updated')) {
        const { value, done } = await liveReader.read()
        if (done) break
        liveText += decoder.decode(value)
      }
      expect(liveText).toContain('id: ')
      expect(liveText).toContain('event: setup')
      expect(liveText).toContain('setup.block.updated')

      // Extract last sequence number from liveText
      const idMatches = Array.from(liveText.matchAll(/id:\s*(\d+)/g))
      expect(idMatches.length).toBeGreaterThan(0)
      const lastSeenSeq = Number.parseInt(idMatches[idMatches.length - 1]![1]!, 10)
      expect(lastSeenSeq).toBeGreaterThan(0)

      // Disconnect live stream
      await liveReader.cancel()

      // Reconnect with cursor to test reconnect resumption without duplicating or missing events
      const reconnectRes = await fetch(
        `${baseUrl2}/api/v1/setup/sessions/${liveSession.id}/events?cursor=${lastSeenSeq}`,
        {
          headers: { ...authHeaders2, accept: 'text/event-stream' },
        },
      )
      expect(reconnectRes.status).toBe(200)
      const reconnectReader = reconnectRes.body!.getReader()

      // Trigger plan while reconnected
      const planRes = await fetch(`${baseUrl2}/api/v1/setup/sessions/${liveSession.id}/plan`, {
        method: 'POST',
        headers: authHeaders2,
        body: JSON.stringify({}),
      })
      expect(planRes.status).toBe(200)

      let reconnectText = ''
      while (!reconnectText.includes('setup.session.updated')) {
        const { value, done } = await reconnectReader.read()
        if (done) break
        reconnectText += decoder.decode(value)
      }
      expect(reconnectText).toContain('id: ')
      const reconnectMatches = Array.from(reconnectText.matchAll(/id:\s*(\d+)/g))
      expect(reconnectMatches.length).toBeGreaterThan(0)
      const newSeq = Number.parseInt(reconnectMatches[0]![1]!, 10)
      expect(newSeq).toBeGreaterThan(lastSeenSeq)

      await reconnectReader.cancel()

      // 12. Tier 3 Fail-closed test on a destructive session
      const createDestructiveRes = await fetch(`${baseUrl2}/api/v1/setup/sessions`, {
        method: 'POST',
        headers: authHeaders2,
        body: JSON.stringify({ title: 'Destructive Session', destructive: true }),
      })
      const destructiveSession = (await createDestructiveRes.json()) as { id: string }
      await fetch(`${baseUrl2}/api/v1/setup/sessions/${destructiveSession.id}/discover`, {
        method: 'POST',
        headers: authHeaders2,
        body: JSON.stringify({}),
      })
      await fetch(`${baseUrl2}/api/v1/setup/sessions/${destructiveSession.id}/plan`, {
        method: 'POST',
        headers: authHeaders2,
        body: JSON.stringify({}),
      })
      await fetch(`${baseUrl2}/api/v1/setup/sessions/${destructiveSession.id}/diff`, {
        method: 'POST',
        headers: authHeaders2,
        body: JSON.stringify({}),
      })

      // Try approve with no confirmation -> 403
      const badApprove = await fetch(
        `${baseUrl2}/api/v1/setup/sessions/${destructiveSession.id}/approve`,
        {
          method: 'POST',
          headers: authHeaders2,
          body: JSON.stringify({}),
        },
      )
      expect(badApprove.status).toBe(403)

      // Try approve with force: true (--yes) -> 403, cannot bypass
      const forceApprove = await fetch(
        `${baseUrl2}/api/v1/setup/sessions/${destructiveSession.id}/approve`,
        {
          method: 'POST',
          headers: authHeaders2,
          body: JSON.stringify({ force: true }),
        },
      )
      expect(forceApprove.status).toBe(403)

      // Approve with confirmation but without step-up -> 403 (assurance_too_low)
      const noStepUpApprove = await fetch(
        `${baseUrl2}/api/v1/setup/sessions/${destructiveSession.id}/approve`,
        {
          method: 'POST',
          headers: authHeaders2,
          body: JSON.stringify({ confirmation: `confirm ${destructiveSession.id}` }),
        },
      )
      expect(noStepUpApprove.status).toBe(403)

      // Step up authentication using bootstrap password
      const stepUpRes = await fetch(`${baseUrl2}/api/v1/auth/step-up`, {
        method: 'POST',
        headers: authHeaders2,
        body: JSON.stringify({ password: bootstrapPassword }),
      })
      expect(stepUpRes.status).toBe(200)
      const { token: steppedToken } = (await stepUpRes.json()) as { token: string }
      const steppedHeaders = { ...authHeaders2, authorization: `Bearer ${steppedToken}` }

      // Approve with stepped-up token and exact confirmation phrase -> 200
      const okApprove = await fetch(
        `${baseUrl2}/api/v1/setup/sessions/${destructiveSession.id}/approve`,
        {
          method: 'POST',
          headers: steppedHeaders,
          body: JSON.stringify({ confirmation: `confirm ${destructiveSession.id}` }),
        },
      )
      expect(okApprove.status).toBe(200)

      const exit2 = await proc2.shutdown()
      expect(exit2.code).toBe(0)
    } finally {
      proc2.kill()
      removeTempDir(dir)
    }
  }, 60_000)
})
