import React from 'react';
import Giscus from '@giscus/react';
import { useRouter } from 'next/router';

const Comment = () => {
  const router = useRouter();
  console.log(router.asPath);

  return (
    <div className={'containerComment'}>
      <Giscus
        key={router.asPath}
        id='comments'
        repo='hunghg255/blog-hunghg'
        repoId='R_kgDOKR9S5w'
        category='Announcements'
        categoryId='DIC_kwDOKR9S584Ciu2v'
        mapping='url'
        reactionsEnabled='1'
        emitMetadata='0'
        inputPosition='top'
        theme='dark'
        lang='en'
      />
    </div>
  );
};

export default Comment;
