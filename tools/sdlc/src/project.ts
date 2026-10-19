/**
 * The GitHub Project (v2) board: finding it, its fields and options by name, its items, and setting
 * a card's fields. A personal project can only be written with a personal access token that has the
 * `project` scope (`SDLC_TOKEN`); neither `GITHUB_TOKEN` nor an app token can.
 */
import type { GitHubClient } from './github.ts';
import { FIELD_STAGE, sameName } from './model.ts';

export interface Field {
  id: string;
  name: string;
  dataType: string;
  options: { id: string; name: string }[];
}

export interface Project {
  id: string;
  number: number;
  title: string;
  url: string;
  shortDescription: string | null;
  fields: Field[];
}

const FIELDS = `fields(first: 50) { nodes {
  ... on ProjectV2FieldCommon { id name dataType }
  ... on ProjectV2SingleSelectField { options { id name } }
} }`;

interface RawProject {
  id: string;
  number: number;
  title: string;
  url: string;
  shortDescription: string | null;
  fields: { nodes: Partial<Field>[] };
}

function toProject(raw: RawProject): Project {
  return {
    ...raw,
    fields: raw.fields.nodes
      .filter((f): f is Field => typeof f.id === 'string')
      .map((f) => ({ ...f, options: f.options ?? [] })),
  };
}

/** The owner's project by number; works for a personal account and for an organization. */
export async function loadProject(
  client: GitHubClient,
  owner: string,
  number: number,
): Promise<Project> {
  const select = `projectV2(number: $number) { id number title url shortDescription ${FIELDS} }`;
  try {
    const data = await client.graphql<{ user: { projectV2: RawProject | null } | null }>(
      `query($owner: String!, $number: Int!) { user(login: $owner) { ${select} } }`,
      { owner, number },
    );
    if (data.user?.projectV2) return toProject(data.user.projectV2);
  } catch {
    // Not a user, or no such project there: try an organization below.
  }
  const data = await client.graphql<{ organization: { projectV2: RawProject | null } | null }>(
    `query($owner: String!, $number: Int!) { organization(login: $owner) { ${select} } }`,
    { owner, number },
  );
  if (!data.organization?.projectV2) throw new Error(`No project #${number} for ${owner}`);
  return toProject(data.organization.projectV2);
}

export async function listProjects(client: GitHubClient, owner: string) {
  const data = await client.graphql<{
    user: {
      projectsV2: { nodes: { number: number; title: string; url: string; closed: boolean }[] };
    } | null;
  }>(
    `query($owner: String!) { user(login: $owner) { projectsV2(first: 30) { nodes { number title url closed } } } }`,
    { owner },
  );
  return data.user?.projectsV2.nodes ?? [];
}

export function findField(project: Project, name: string): Field | undefined {
  return project.fields.find((f) => sameName(f.name, name));
}

export function findOption(field: Field | undefined, name: string) {
  return field?.options.find((o) => sameName(o.name, name));
}

export interface ProjectItem {
  id: string;
  updatedAt: string;
  status: string | null;
  stage: string | null;
  content:
    | { type: 'DraftIssue'; id: string; title: string; body: string }
    | {
        type: 'Issue';
        id: string;
        number: number;
        title: string;
        state: 'OPEN' | 'CLOSED';
        body: string;
        repo: string;
        labels: string[];
        comments: { author: string | null; body: string; id: string }[];
      }
    | { type: 'PullRequest'; number: number; repo: string }
    | { type: 'Other' };
}

interface RawItem {
  id: string;
  updatedAt: string;
  status: { name?: string } | null;
  stage: { name?: string } | null;
  content: {
    __typename: string;
    id?: string;
    number?: number;
    title?: string;
    state?: 'OPEN' | 'CLOSED';
    body?: string;
    repository?: { nameWithOwner: string };
    labels?: { nodes: { name: string }[] };
    comments?: { nodes: { id: string; body: string; author: { login: string } | null }[] };
  } | null;
}

/** Every item on the board, with the issue text and the first comments (where the state lives). */
export async function listItems(
  client: GitHubClient,
  projectId: string,
  stageField: string,
): Promise<ProjectItem[]> {
  const items: ProjectItem[] = [];
  let after: string | null = null;
  do {
    const data: {
      node: {
        items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawItem[] };
      };
    } = await client.graphql(
      `query($id: ID!, $after: String, $stage: String!) { node(id: $id) { ... on ProjectV2 {
        items(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes {
          id updatedAt
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          stage: fieldValueByName(name: $stage) { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            __typename
            ... on DraftIssue { id title body }
            ... on Issue { id number title state body repository { nameWithOwner }
              labels(first: 30) { nodes { name } }
              comments(first: 50) { nodes { id body author { login } } } }
            ... on PullRequest { number repository { nameWithOwner } }
          }
        } }
      } } }`,
      { id: projectId, after, stage: stageField },
    );
    for (const raw of data.node.items.nodes) items.push(toItem(raw));
    after = data.node.items.pageInfo.hasNextPage ? data.node.items.pageInfo.endCursor : null;
  } while (after);
  return items;
}

function toItem(raw: RawItem): ProjectItem {
  const c = raw.content;
  const base = {
    id: raw.id,
    updatedAt: raw.updatedAt,
    status: raw.status?.name ?? null,
    stage: raw.stage?.name ?? null,
  };
  if (c?.__typename === 'DraftIssue') {
    return {
      ...base,
      content: { type: 'DraftIssue', id: c.id ?? '', title: c.title ?? '', body: c.body ?? '' },
    };
  }
  if (c?.__typename === 'Issue') {
    return {
      ...base,
      content: {
        type: 'Issue',
        id: c.id ?? '',
        number: c.number ?? 0,
        title: c.title ?? '',
        state: c.state ?? 'OPEN',
        body: c.body ?? '',
        repo: c.repository?.nameWithOwner ?? '',
        labels: c.labels?.nodes.map((l) => l.name) ?? [],
        comments: (c.comments?.nodes ?? []).map((n) => ({
          id: n.id,
          body: n.body,
          author: n.author?.login ?? null,
        })),
      },
    };
  }
  if (c?.__typename === 'PullRequest') {
    return {
      ...base,
      content: {
        type: 'PullRequest',
        number: c.number ?? 0,
        repo: c.repository?.nameWithOwner ?? '',
      },
    };
  }
  return { ...base, content: { type: 'Other' } };
}

/** The board item for an issue and its column, adding the issue to the board if asked to. */
export async function boardItem(
  client: GitHubClient,
  project: Project,
  owner: string,
  repo: string,
  issue: number,
  options: { add: boolean },
): Promise<{ itemId: string; status: string | null; stage: string | null } | null> {
  const data = await client.graphql<{
    repository: {
      issue: {
        id: string;
        projectItems: {
          nodes: {
            id: string;
            project: { id: string };
            status: { name?: string } | null;
            stage: { name?: string } | null;
          }[];
        };
      } | null;
    };
  }>(
    `query($owner: String!, $repo: String!, $issue: Int!, $stage: String!) { repository(owner: $owner, name: $repo) {
      issue(number: $issue) { id projectItems(first: 20) { nodes { id project { id }
        status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        stage: fieldValueByName(name: $stage) { ... on ProjectV2ItemFieldSingleSelectValue { name } }
      } } } } }`,
    { owner, repo, issue, stage: FIELD_STAGE },
  );
  const found = data.repository.issue;
  if (!found) return null;
  const existing = found.projectItems.nodes.find((n) => n.project.id === project.id);
  if (existing) {
    return {
      itemId: existing.id,
      status: existing.status?.name ?? null,
      stage: existing.stage?.name ?? null,
    };
  }
  if (!options.add) return null;
  return { itemId: await addItem(client, project.id, found.id), status: null, stage: null };
}

export async function addItem(
  client: GitHubClient,
  projectId: string,
  contentId: string,
): Promise<string> {
  const data = await client.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
    `mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } } }`,
    { project: projectId, content: contentId },
  );
  return data.addProjectV2ItemById.item.id;
}

export async function setSelect(
  client: GitHubClient,
  project: Project,
  itemId: string,
  fieldName: string,
  optionName: string,
): Promise<boolean> {
  const field = findField(project, fieldName);
  const option = findOption(field, optionName);
  if (!field || !option) return false;
  await client.graphql(
    `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) { updateProjectV2ItemFieldValue(input: {
      projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) { projectV2Item { id } } }`,
    { p: project.id, i: itemId, f: field.id, o: option.id },
  );
  return true;
}

export async function setText(
  client: GitHubClient,
  project: Project,
  itemId: string,
  fieldName: string,
  text: string,
): Promise<boolean> {
  const field = findField(project, fieldName);
  if (!field) return false;
  await client.graphql(
    `mutation($p: ID!, $i: ID!, $f: ID!, $t: String!) { updateProjectV2ItemFieldValue(input: {
      projectId: $p, itemId: $i, fieldId: $f, value: { text: $t } }) { projectV2Item { id } } }`,
    { p: project.id, i: itemId, f: field.id, t: text },
  );
  return true;
}

export async function convertDraft(
  client: GitHubClient,
  itemId: string,
  repositoryId: string,
): Promise<number> {
  const data = await client.graphql<{
    convertProjectV2DraftIssueItemToIssue: { item: { content: { number: number } } };
  }>(
    `mutation($item: ID!, $repo: ID!) { convertProjectV2DraftIssueItemToIssue(input: { itemId: $item, repositoryId: $repo }) {
      item { content { ... on Issue { number } } } } }`,
    { item: itemId, repo: repositoryId },
  );
  return data.convertProjectV2DraftIssueItemToIssue.item.content.number;
}

export async function createSelectField(
  client: GitHubClient,
  projectId: string,
  name: string,
  options: { name: string; color: string }[],
): Promise<void> {
  await client.graphql(
    `mutation($p: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
      createProjectV2Field(input: { projectId: $p, dataType: SINGLE_SELECT, name: $name, singleSelectOptions: $options }) {
        projectV2Field { ... on ProjectV2SingleSelectField { id } } } }`,
    { p: projectId, name, options: options.map((o) => ({ ...o, description: '' })) },
  );
}

export async function createTextField(
  client: GitHubClient,
  projectId: string,
  name: string,
): Promise<void> {
  await client.graphql(
    `mutation($p: ID!, $name: String!) { createProjectV2Field(input: { projectId: $p, dataType: TEXT, name: $name }) {
      projectV2Field { ... on ProjectV2Field { id } } } }`,
    { p: projectId, name },
  );
}

export async function linkRepository(
  client: GitHubClient,
  projectId: string,
  repositoryId: string,
): Promise<void> {
  await client.graphql(
    `mutation($p: ID!, $r: ID!) { linkProjectV2ToRepository(input: { projectId: $p, repositoryId: $r }) { repository { id } } }`,
    { p: projectId, r: repositoryId },
  );
}

/** The one line under the board's title, used to show a pause to anyone looking at the board. */
export async function setShortDescription(
  client: GitHubClient,
  projectId: string,
  text: string,
): Promise<void> {
  await client.graphql(
    `mutation($p: ID!, $t: String!) { updateProjectV2(input: { projectId: $p, shortDescription: $t }) { projectV2 { id } } }`,
    { p: projectId, t: text },
  );
}
