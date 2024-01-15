import path from 'path';
import { getPostDataFromDirectory } from './markdown-utils';

const blogsDirectory = path.join(process.cwd(), 'posts/tools');

export async function getToolsData() {
  return getPostDataFromDirectory('tools', blogsDirectory);
}
