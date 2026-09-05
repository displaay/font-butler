import crypto from 'node:crypto'
import fs from 'node:fs'
import { projectsPath } from './paths.ts'
import type { AppPaths } from './paths.ts'
import type { ActivationOwner, CatalogEntry, ProjectFile, ProjectMember, ProjectSet } from './types.ts'

export function loadProjects(paths: AppPaths): ProjectSet[] {
  const file = projectsPath(paths)
  if (!fs.existsSync(file)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectFile
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
      return []
    }
    return parsed.projects
  } catch {
    return []
  }
}

export function saveProjects(paths: AppPaths, projects: ProjectSet[]): void {
  const tmp = `${projectsPath(paths)}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, projects } satisfies ProjectFile, null, 2))
  fs.renameSync(tmp, projectsPath(paths))
}

export function createProject(name: string, memberIds: string[] = []): ProjectSet {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled project',
    members: memberIds.map((assetId) => ({ assetId })),
    desiredActive: false,
  }
}

export function upsertProject(paths: AppPaths, project: ProjectSet): ProjectSet {
  const projects = loadProjects(paths)
  const index = projects.findIndex((item) => item.id === project.id)
  if (index === -1) {
    projects.unshift(project)
  } else {
    projects[index] = project
  }
  saveProjects(paths, projects)
  return project
}

export function removeProject(paths: AppPaths, id: string): ProjectSet | undefined {
  const projects = loadProjects(paths)
  const index = projects.findIndex((item) => item.id === id)
  if (index === -1) return undefined
  const [removed] = projects.splice(index, 1)
  saveProjects(paths, projects)
  return removed
}

export function addManualOwner(entry: CatalogEntry): void {
  const owners = entry.activationOwners ?? []
  if (owners.some((owner) => owner.kind === 'manual')) {
    entry.activationOwners = owners
    return
  }
  entry.activationOwners = [...owners, { kind: 'manual' }]
}

export function addProjectOwner(entry: CatalogEntry, projectId: string): void {
  const owners = entry.activationOwners ?? []
  if (owners.some((owner) => owner.kind === 'project' && owner.projectId === projectId)) {
    entry.activationOwners = owners
    return
  }
  entry.activationOwners = [...owners, { kind: 'project', projectId }]
}

export function removeProjectOwner(entry: CatalogEntry, projectId: string): void {
  entry.activationOwners = (entry.activationOwners ?? []).filter(
    (owner) => !(owner.kind === 'project' && owner.projectId === projectId),
  )
}

export function removeManualOwner(entry: CatalogEntry): void {
  entry.activationOwners = (entry.activationOwners ?? []).filter((owner) => owner.kind !== 'manual')
}

export function hasActivationDemand(entry: CatalogEntry): boolean {
  return (entry.activationOwners ?? []).length > 0
}

export function pinnedFingerprints(projects: ProjectSet[]): Set<string> {
  const pins = new Set<string>()
  for (const project of projects) {
    for (const member of project.members) {
      if (member.pinFingerprint) pins.add(member.pinFingerprint)
    }
  }
  return pins
}

export function projectsForAsset(projects: ProjectSet[], assetId: string): ProjectSet[] {
  return projects.filter((project) => project.members.some((member) => member.assetId === assetId))
}

export function setMemberUnsatisfied(project: ProjectSet, assetId: string, unsatisfied: boolean): void {
  const member = project.members.find((item) => item.assetId === assetId)
  if (member) member.unsatisfied = unsatisfied
}

export function projectActivationState(
  project: ProjectSet,
  entries: CatalogEntry[],
): 'active' | 'partial' | 'inactive' | 'preview' {
  if (project.members.length === 0) return 'inactive'
  const members = project.members
    .map((member) => entries.find((entry) => entry.id === member.assetId))
    .filter((entry): entry is CatalogEntry => Boolean(entry))
  if (members.length && members.every((entry) => entry.previewOnly)) {
    return 'preview'
  }
  const required = members.filter((entry) => !entry.previewOnly)
  if (required.length === 0) return 'preview'
  const satisfied = required.filter(
    (entry) => entry.status === 'installed' || entry.status === 'outdated',
  )
  if (satisfied.length === required.length && project.desiredActive) return 'active'
  if (satisfied.length > 0 && project.desiredActive) return 'partial'
  return 'inactive'
}

export function pinConflict(
  projects: ProjectSet[],
  assetId: string,
  fingerprint: string,
): ProjectSet | undefined {
  return projects.find((project) =>
    project.desiredActive &&
    project.members.some(
      (member) => member.assetId === assetId && member.pinFingerprint && member.pinFingerprint !== fingerprint,
    ),
  )
}

export type { ActivationOwner, ProjectMember }
