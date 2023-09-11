import path from "path";
import {
  getAllPostIds,
  getPostDataFromDirectory,
  getSortedPostData,
} from "./markdown-utils";

const blogsDirectory = path.join(process.cwd(), "posts/blogs");

export function getSortedBlogsData() {
  return getSortedPostData(blogsDirectory);
}

export function getAllBlogIds() {
  return getAllPostIds(blogsDirectory);
}

export async function getBlogData(id: string) {
  return await getPostDataFromDirectory(id, blogsDirectory);
}
