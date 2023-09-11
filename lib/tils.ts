import path from "path";
import {
  getAllPostIds,
  getPostDataFromDirectory,
  getSortedPostData,
} from "./markdown-utils";

const tilsDirectory = path.join(process.cwd(), "posts/tils");

export function getSortedTilsData() {
  return getSortedPostData(tilsDirectory);
}

export function getAllTilIds() {
  return getAllPostIds(tilsDirectory);
}

export async function getTilData(id: string) {
  return await getPostDataFromDirectory(id, tilsDirectory);
}
