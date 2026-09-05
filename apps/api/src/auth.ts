import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import type { UserAccount, UserSession } from '@fengshui/domain'

const scrypt = promisify(scryptCallback)

export interface StoredUserAccount extends UserAccount {
  passwordHash: string
}

export interface AccountStore {
  createUser(input: { username: string; displayName: string; passwordHash: string }): Promise<UserAccount>
  listUsers(): Promise<UserAccount[]>
  findUserByUsername(username: string): Promise<StoredUserAccount | undefined>
  getUser(id: string): Promise<UserAccount | undefined>
  setUserStatus(id: string, status: UserAccount['status']): Promise<UserAccount | undefined>
  setPassword(id: string, passwordHash: string): Promise<UserAccount | undefined>
  bindPrincipal(userId: string, principalId: string): Promise<UserAccount | undefined>
  recordLogin(userId: string, loggedInAt: string): Promise<UserAccount | undefined>
  createSession(session: UserSession): Promise<void>
  findSessionByTokenHash(tokenHash: string): Promise<{ session: UserSession; user: UserAccount } | undefined>
  revokeSession(tokenHash: string): Promise<void>
  revokeUserSessions(userId: string): Promise<void>
  ping(): Promise<void>
  close(): Promise<void>
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64) as Buffer
  return `scrypt-v1:${salt.toString('base64url')}:${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [version, saltText, hashText] = encoded.split(':')
  if (version !== 'scrypt-v1' || !saltText || !hashText) return false
  try {
    const expected = Buffer.from(hashText, 'base64url')
    const actual = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length) as Buffer
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

interface AccountData { users: StoredUserAccount[]; sessions: UserSession[] }

export class FileAccountStore implements AccountStore {
  private queue: Promise<void> = Promise.resolve()
  constructor(private readonly path: string) {}

  async createUser(input: { username: string; displayName: string; passwordHash: string }): Promise<UserAccount> {
    return this.mutate((data) => {
      const username = normalizeUsername(input.username)
      if (data.users.some((user) => user.username === username)) throw new Error('username already exists')
      const now = new Date().toISOString()
      const user: StoredUserAccount = { id: crypto.randomUUID(), username, displayName: input.displayName.trim(), status: 'active', passwordHash: input.passwordHash, createdAt: now, updatedAt: now }
      data.users.push(user)
      return publicUser(user)
    })
  }
  async listUsers() { await this.queue; return (await this.all()).users.map(publicUser).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  async findUserByUsername(username: string) { await this.queue; const user = (await this.all()).users.find((item) => item.username === normalizeUsername(username)); return user ? structuredClone(user) : undefined }
  async getUser(id: string) { await this.queue; const user = (await this.all()).users.find((item) => item.id === id); return user ? publicUser(user) : undefined }
  async setUserStatus(id: string, status: UserAccount['status']) { return this.mutate((data) => { const user = data.users.find((item) => item.id === id); if (!user) return undefined; user.status = status; user.updatedAt = new Date().toISOString(); if (status === 'disabled') data.sessions = data.sessions.filter((session) => session.userId !== id); return publicUser(user) }) }
  async setPassword(id: string, passwordHash: string) { return this.mutate((data) => { const user = data.users.find((item) => item.id === id); if (!user) return undefined; user.passwordHash = passwordHash; user.updatedAt = new Date().toISOString(); data.sessions = data.sessions.filter((session) => session.userId !== id); return publicUser(user) }) }
  async bindPrincipal(userId: string, principalId: string) { return this.mutate((data) => { const user = data.users.find((item) => item.id === userId); if (!user) return undefined; if (!user.principalId) { user.principalId = principalId; user.updatedAt = new Date().toISOString() } return publicUser(user) }) }
  async recordLogin(userId: string, loggedInAt: string) { return this.mutate((data) => { const user = data.users.find((item) => item.id === userId); if (!user) return undefined; user.lastLoginAt = loggedInAt; return publicUser(user) }) }
  async createSession(session: UserSession) { await this.mutate((data) => { data.sessions.push(structuredClone(session)) }) }
  async findSessionByTokenHash(tokenHash: string) { await this.queue; const data = await this.all(); const session = data.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > new Date().toISOString()); if (!session) return undefined; const user = data.users.find((item) => item.id === session.userId); return user ? { session: structuredClone(session), user: publicUser(user) } : undefined }
  async revokeSession(tokenHash: string) { await this.mutate((data) => { data.sessions = data.sessions.filter((item) => item.tokenHash !== tokenHash) }) }
  async revokeUserSessions(userId: string) { await this.mutate((data) => { data.sessions = data.sessions.filter((item) => item.userId !== userId) }) }
  async ping() { await this.all() }
  async close() { await this.queue }

  private async all(): Promise<AccountData> { try { const raw = JSON.parse(await readFile(this.path, 'utf8')) as AccountData; return { users: raw.users ?? [], sessions: raw.sessions ?? [] } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { users: [], sessions: [] }; throw error } }
  private async mutate<T>(fn: (data: AccountData) => T | Promise<T>): Promise<T> { let resolve!: () => void; const prior = this.queue; this.queue = new Promise<void>((done) => { resolve = done }); await prior; try { const data = await this.all(); data.sessions = data.sessions.filter((session) => session.expiresAt > new Date().toISOString()); const result = await fn(data); await mkdir(dirname(this.path), { recursive: true }); const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`; await writeFile(temporary, JSON.stringify(data, null, 2)); await rename(temporary, this.path); return result } finally { resolve() } }
}

function publicUser(user: StoredUserAccount): UserAccount {
  const { passwordHash: _passwordHash, ...result } = user
  return structuredClone(result)
}
