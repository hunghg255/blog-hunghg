import path from 'path';
import { getAllPostIds, getPostDataFromDirectory, getSortedPostData } from './markdown-utils';

const jsDirectory = path.join(process.cwd(), 'posts/javascript');

export function getSortedJsData() {
  return getSortedPostData(jsDirectory);
}

export function getAllJSIds() {
  return getAllPostIds(jsDirectory);
}

export async function getJsData(id: string) {
  return await getPostDataFromDirectory(id, jsDirectory);
}
