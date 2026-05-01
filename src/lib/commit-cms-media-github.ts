import { RequestError } from "@octokit/request-error";
import { CMS_PATHS } from "./cms-paths";
import { GithubPublisher } from "./github-service";
import { parseOwnerRepo } from "./github-repo-content";
import type { ProcessedCmsImage } from "./process-cms-image";

/**
 * Grava imagem já processada (`processCmsImageBuffer`) em `public/assets/cms/` no repo do cliente.
 */
export async function commitProcessedCmsMediaToGithub(options: {
  token: string;
  githubRepoFullName: string;
  branch: string;
  processed: ProcessedCmsImage;
}): Promise<{ fileName: string; publicUrl: string; repoPath: string }> {
  const { token, githubRepoFullName, branch, processed } = options;
  const { owner, repo } = parseOwnerRepo(githubRepoFullName);
  const base = `cms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fileName = `${base}.${processed.ext}`;
  const repoPath = `${CMS_PATHS.clientCmsPublicDir}/${fileName}`;
  const publicUrl = `/assets/cms/${fileName}`;
  const message = `content(assets): mídia CMS ${fileName}`;
  const publisher = new GithubPublisher({ token });
  try {
    await publisher.createOrUpdateFileBytes(owner, repo, repoPath, processed.buffer, message, { branch });
    return { fileName, publicUrl, repoPath };
  } catch (e) {
    if (e instanceof RequestError) {
      throw new Error(e.message || `GitHub HTTP ${e.status}`);
    }
    throw e;
  }
}
