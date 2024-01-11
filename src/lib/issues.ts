import path from 'path';
import fs from 'fs';
import matter from 'gray-matter';
import { getPostDataFromDirectory } from '~lib/markdown-utils';

const blogsDirectory = path.join(process.cwd(), 'posts/issues');

export function getSortedIssues(dir: string) {
  // Get file names under dir
  const folderNames = fs.readdirSync(dir);

  const data = [];

  for (const folderName of folderNames) {
    const fullPath = path.join(dir, folderName);
    const mdFile = fs.readdirSync(fullPath);

    const allPostsData = mdFile.map((fileName) => {
      const id = fileName.replace(/\.md$/, '');

      // Read markdown file as string
      const pathMd = path.join(fullPath, fileName);
      const fileContents = fs.readFileSync(pathMd, 'utf8');

      // // Use gray-matter to parse the post metadata section
      const matterResult = matter(fileContents);

      // Combine the data with the id
      return {
        id,
        ...(matterResult.data as { date: string; title: string }),
      };
    });

    data.push({
      folderName: folderName,
      data: allPostsData.sort((a, b) => {
        if (a.date < b.date) {
          return 1;
        } else {
          return -1;
        }
      }),
    });
  }

  return data;
}

export function getAllIssueIds(dir: string) {
  // Get file names under dir
  const folderNames = fs.readdirSync(dir);

  const data = [] as any;

  for (const folderName of folderNames) {
    const fullPath = path.join(dir, folderName);
    const mdFile = fs.readdirSync(fullPath);

    mdFile.forEach((fileName) => {
      const id = fileName.replace(/\.md$/, '');

      data.push({
        params: {
          id: `${folderName}--${id}`,
        },
      });
    });
  }

  return data;
}

export function getSortedIssuesData() {
  return getSortedIssues(blogsDirectory);
}

export function getAllIssuesIds() {
  return getAllIssueIds(blogsDirectory);
}

export async function getIssuesData(ids: string) {
  const [folderName, id] = ids.split('--');
  const fullPath = path.join(blogsDirectory, folderName);

  return getPostDataFromDirectory(id, fullPath);
}
