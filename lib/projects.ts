import path from "path";
import {
  getAllPostIds,
  getPostDataFromDirectory,
  getSortedPostData,
} from "./markdown-utils";

const projectsDirectory = path.join(process.cwd(), "posts/projects");

export function getSortedProjectsData() {
  return getSortedPostData(projectsDirectory);
}

export function getAllProjectIds() {
  return getAllPostIds(projectsDirectory);
}

export async function getProjectData(id: string) {
  return await getPostDataFromDirectory(id, projectsDirectory);
}
