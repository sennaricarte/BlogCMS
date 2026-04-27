import type { APIRoute } from "astro";
import { CMS_PATHS } from "../../../lib/cms-paths";
import type { BlogFrontmatterInput } from "../../../lib/cms-matter";
import { parseMarkdownFile, serializeBlogMarkdown } from "../../../lib/cms-matter";
import { GithubPublisher } from "../../../lib/github-service";
import { parseOwnerRepo } from "../../../lib/github-repo-content";
import {
  isPublicationDueDate,
  normalizePubDateString,
  todayIsoDate,
} from "../../../lib/scheduled-publish-helpers";
import projectsData from "../../../data/projects.json";

export const prerender = false;

function json(o: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function isAuthorized(request: Request): boolean {
  const expected = (import.meta.env.SCHEDULED_PUBLISH_SECRET as string | undefined)?.trim();
  if (!expected) {
    return false;
  }
  const q = new URL(request.url).searchParams.get("secret");
  if (q && q === expected) {
    return true;
  }
  const h = request.headers.get("Authorization");
  if (h?.startsWith("Bearer ")) {
    return h.slice(7).trim() === expected;
  }
  return false;
}

function dataToBlogInput(
  d: Record<string, unknown>,
  options: { draft: boolean; clearScheduled: boolean },
): BlogFrontmatterInput {
  const title = String(d.title ?? "Sem título");
  const description = String(d.description ?? "");
  const pub = normalizePubDateString(d.pubDate) || todayIsoDate();
  const author = String(d.author ?? "Equipa");
  const heroImage = String(d.heroImage ?? "../../assets/blog/hero-primeiro.svg");
  const tags = Array.isArray(d.tags) ? d.tags.map((t) => String(t)) : [];
  const out: BlogFrontmatterInput = {
    title,
    description,
    pubDate: pub,
    author,
    heroImage,
    tags,
    category: typeof d.category === "string" && d.category.trim() ? d.category.trim() : undefined,
    draft: options.draft,
  };
  if (d.updatedDate) {
    if (d.updatedDate instanceof Date) {
      out.updatedDate = d.updatedDate.toISOString().slice(0, 10);
    } else {
      out.updatedDate = String(d.updatedDate).slice(0, 10);
    }
  }
  if (typeof d.seoTitle === "string" && d.seoTitle.trim()) {
    out.seoTitle = d.seoTitle.trim();
  }
  if (typeof d.seoFocusKeyword === "string" && d.seoFocusKeyword.trim()) {
    out.seoFocusKeyword = d.seoFocusKeyword.trim();
  }
  if (!options.clearScheduled && d.scheduled) {
    out.scheduled = true;
  }
  return out;
}

export const GET: APIRoute = async ({ request }) => {
  return runPublish(request);
};

export const POST: APIRoute = async ({ request }) => {
  return runPublish(request);
};

async function runPublish(request: Request) {
  if (!isAuthorized(request)) {
    return json({ ok: false, error: "Não autorizado. Define SCHEDULED_PUBLISH_SECRET e envia Bearer ou ?secret=." }, 401);
  }

  const token = (import.meta.env.SCHEDULED_PUBLISH_GITHUB_TOKEN as string | undefined)?.trim();
  if (!token) {
    return json(
      { ok: false, error: "SCHEDULED_PUBLISH_GITHUB_TOKEN em falta (PAT com acesso às orgs/repositórios dos projetos)." },
      503,
    );
  }

  const branch = (import.meta.env.SCHEDULED_PUBLISH_GITHUB_BRANCH as string | undefined)?.trim() || "main";
  const publisher = new GithubPublisher({ token });
  const published: string[] = [];
  const errors: string[] = [];

  const projects = projectsData.projects;
  for (const p of projects) {
    const full = p.githubRepoFullName?.trim();
    if (!full) continue;
    let owner: string;
    let repo: string;
    try {
      ({ owner, repo } = parseOwnerRepo(full));
    } catch {
      errors.push(`Repositório inválido: ${full}`);
      continue;
    }
    let list: Awaited<ReturnType<GithubPublisher["listPath"]>>;
    try {
      list = await publisher.listPath(owner, repo, CMS_PATHS.blog, { branch });
    } catch (e) {
      errors.push(
        `${full}: list ${e instanceof Error ? e.message : "erro"}`,
      );
      continue;
    }
    const mds = list.filter((i) => i.type === "file" && i.name?.endsWith(".md"));
    for (const f of mds) {
      const path = `${CMS_PATHS.blog}/${f.name}`;
      let text: string;
      let sha: string;
      try {
        const g = await publisher.getFileText(owner, repo, path, { branch });
        text = g.text;
        sha = g.sha;
      } catch (e) {
        errors.push(`${path}: ${e instanceof Error ? e.message : "leitura"}`);
        continue;
      }
      const parsed = parseMarkdownFile(text);
      const d = parsed.data as Record<string, unknown>;
      const draft = Boolean(d.draft);
      const sched = Boolean(d.scheduled);
      if (!sched || !draft) {
        continue;
      }
      if (!isPublicationDueDate(d.pubDate)) {
        continue;
      }
      const newData = dataToBlogInput(d, { draft: false, clearScheduled: true });
      const outMd = serializeBlogMarkdown(parsed.content, newData);
      try {
        await publisher.createOrUpdateFile(
          owner,
          repo,
          path,
          outMd,
          `chore(cms): publicar agendado — ${String(d.title || f.name).slice(0, 60)}`,
          { branch, sha },
        );
        published.push(`${full}@${path}`);
      } catch (e) {
        errors.push(`${path}: ${e instanceof Error ? e.message : "commit"}`);
      }
    }
  }

  return json({
    ok: errors.length === 0 && published.length >= 0,
    date: todayIsoDate(),
    published,
    errorCount: errors.length,
    errors: errors.length ? errors : undefined,
  });
}
