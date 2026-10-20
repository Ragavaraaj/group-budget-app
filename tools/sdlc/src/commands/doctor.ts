/**
 * SDLC Doctor: checks the setup and fixes what is safe to fix. It creates the AI stage and AI note
 * fields, the labels and the control issue, links the repository and brings bug issues onto the
 * board. It never rewrites the Status field: changing a field's options can wipe the values cards
 * already have, so a missing column is reported for the owner to add by hand.
 */
import { loadControl, openProject, renderControl, saveControl } from '../card.ts';
import { type Env, summary } from '../env.ts';
import { AREAS, FIELD_NOTE, FIELD_STAGE, LABELS, STAGE_COLORS, STAGES, STATUS } from '../model.ts';
import {
  boardItem,
  createSelectField,
  createTextField,
  findField,
  findOption,
  linkRepository,
  listProjects,
  loadProject,
  setSelect,
} from '../project.ts';
import { createIssue, ensureLabel, repositoryId, searchIssues } from '../repo.ts';

type Check = { ok: boolean | 'warn'; what: string; detail?: string };

function table(checks: Check[]): string {
  const icon = (ok: Check['ok']) => (ok === true ? '✅' : ok === 'warn' ? '⚠️' : '❌');
  return [
    '| | Check | Detail |',
    '| --- | --- | --- |',
    ...checks.map((c) => `| ${icon(c.ok)} | ${c.what} | ${c.detail ?? ''} |`),
  ].join('\n');
}

export async function doctor(env: Env): Promise<boolean> {
  const checks: Check[] = [];
  const has = (name: string) => (process.env[name] ?? '') === 'true';
  const claude = has('HAS_CLAUDE_CODE_OAUTH_TOKEN') || has('HAS_ANTHROPIC_API_KEY');
  checks.push({
    ok: claude,
    what: 'Claude credentials',
    detail: has('HAS_CLAUDE_CODE_OAUTH_TOKEN')
      ? 'CLAUDE_CODE_OAUTH_TOKEN (subscription)'
      : has('HAS_ANTHROPIC_API_KEY')
        ? 'ANTHROPIC_API_KEY'
        : 'add the CLAUDE_CODE_OAUTH_TOKEN secret (`claude setup-token`)',
  });
  checks.push({
    ok: env.pat !== null,
    what: 'SDLC_TOKEN secret',
    detail: env.pat ? 'set' : 'a classic token with the `project` and `public_repo` scopes',
  });

  if (!env.pat) {
    summary(`## SDLC Doctor\n\n${table(checks)}`);
    return false;
  }
  if (!env.projectNumber) {
    const projects = await listProjects(env.pat, env.projectOwner).catch(() => []);
    checks.push({
      ok: false,
      what: 'PROJECT_NUMBER variable',
      detail: projects.length
        ? `set it to one of: ${projects
            .filter((p) => !p.closed)
            .map((p) => `${p.number} (${p.title})`)
            .join(', ')}`
        : `no projects found for ${env.projectOwner}`,
    });
    summary(`## SDLC Doctor\n\n${table(checks)}`);
    return false;
  }

  const project = await openProject(env);
  if (!project) {
    checks.push({
      ok: false,
      what: 'Board',
      detail: `project #${env.projectNumber} of ${env.projectOwner} could not be read`,
    });
    summary(`## SDLC Doctor\n\n${table(checks)}`);
    return false;
  }
  checks.push({ ok: true, what: 'Board', detail: `[${project.title}](${project.url})` });

  const status = findField(project, 'Status');
  const missingColumns = Object.values(STATUS).filter((name) => !findOption(status, name));
  checks.push({
    ok: missingColumns.length === 0,
    what: 'Status columns',
    detail: missingColumns.length
      ? `add these options to the Status field: ${missingColumns.join(', ')}`
      : Object.values(STATUS).join(' → '),
  });

  const repoNodeId = await repositoryId(env.gh, env.repo);
  let changed = false;
  if (!findField(project, FIELD_STAGE)) {
    await createSelectField(
      env.pat,
      project.id,
      FIELD_STAGE,
      Object.entries(STAGES).map(([key, name]) => ({
        name,
        color: STAGE_COLORS[key as keyof typeof STAGES],
      })),
    );
    checks.push({ ok: true, what: `${FIELD_STAGE} field`, detail: 'created' });
    changed = true;
  } else {
    const missing = Object.values(STAGES).filter(
      (name) => !findOption(findField(project, FIELD_STAGE), name),
    );
    checks.push({
      ok: missing.length === 0 ? true : 'warn',
      what: `${FIELD_STAGE} field`,
      detail: missing.length
        ? `missing options (add by hand): ${missing.join(', ')}`
        : 'all options present',
    });
  }
  if (!findField(project, FIELD_NOTE)) {
    await createTextField(env.pat, project.id, FIELD_NOTE);
    checks.push({ ok: true, what: `${FIELD_NOTE} field`, detail: 'created' });
    changed = true;
  } else {
    checks.push({ ok: true, what: `${FIELD_NOTE} field`, detail: 'present' });
  }
  await linkRepository(env.pat, project.id, repoNodeId).then(
    () => checks.push({ ok: true, what: 'Repository linked to the board' }),
    (error: Error) => checks.push({ ok: 'warn', what: 'Repository link', detail: error.message }),
  );

  const labels = [
    ...Object.values(LABELS),
    ...AREAS.map((area) => ({
      name: `area:${area}`,
      color: 'ededed',
      description: `Area: ${area}`,
    })),
  ];
  let created = 0;
  for (const label of labels) {
    if ((await ensureLabel(env.gh, env.repo, label)) === 'created') created++;
  }
  checks.push({ ok: true, what: 'Labels', detail: `${labels.length} checked, ${created} created` });

  let control = await loadControl(env);
  if (!control) {
    const issue = await createIssue(env.gh, env.repo, {
      title: 'AI SDLC control',
      body: '',
      labels: [LABELS.control.name],
    });
    control = {
      number: issue.number,
      pausedUntil: null,
      manual: false,
      reason: null,
      since: null,
      limitHits: 0,
    };
    await saveControl(env, control);
    await env.pat
      .graphql(`mutation($id: ID!) { pinIssue(input: { issueId: $id }) { issue { id } } }`, {
        id: issue.node_id,
      })
      .catch(() => undefined);
    checks.push({ ok: true, what: 'Control issue', detail: `created #${issue.number}` });
  } else {
    checks.push({
      ok: true,
      what: 'Control issue',
      detail: `#${control.number}: ${renderControl(control, env.now()).split('\n')[2]}`,
    });
  }

  // Bring bug issues onto the board (closed ones straight to Done), so bugs are tracked there.
  const fresh = changed ? await loadProject(env.pat, env.projectOwner, project.number) : project;
  let added = 0;
  for (const issue of await searchIssues(env.gh, env.repo, `is:issue label:${LABELS.bug.name}`)) {
    const before = await boardItem(env.pat, fresh, env.repo.owner, env.repo.name, issue.number, {
      add: false,
    });
    if (before) continue;
    const item = await boardItem(env.pat, fresh, env.repo.owner, env.repo.name, issue.number, {
      add: true,
    });
    if (item) {
      await setSelect(
        env.pat,
        fresh,
        item.itemId,
        'Status',
        issue.state === 'closed' ? STATUS.done : STATUS.todo,
      );
      added++;
    }
  }
  checks.push({ ok: true, what: 'Bug issues on the board', detail: `${added} added` });

  const failed = checks.some((c) => c.ok === false);
  summary(
    `## SDLC Doctor\n\n${table(checks)}\n\n${failed ? 'Fix the ❌ rows, then run Doctor again.' : 'Ready.'}`,
  );
  return !failed;
}
