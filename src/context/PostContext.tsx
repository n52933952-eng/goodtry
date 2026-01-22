import React, { createContext, useState, useContext, ReactNode } from 'react';

export interface Post {
  _id: string;
  postedBy: {
    _id: string;
    name: string;
    username: string;
    profilePic?: string;
  };
  text: string;
  img?: string;
  thumbnail?: string;
  isCollaborative?: boolean;
  contributors?: any[];
  likes: string[];
  replies: any[];
  createdAt: string;
  updatedAt: string;
  // Special post types
  isWeatherPost?: boolean;
  isFootballPost?: boolean;
  weatherData?: any;
  footballData?: any;
  chessGameData?: string; // JSON string containing chess game data
}

interface PostContextType {
  posts: Post[];
  setPosts: (posts: Post[]) => void;
  addPost: (post: Post) => void;
  updatePost: (postId: string, updates: Partial<Post>) => void;
  deletePost: (postId: string) => void;
  likePost: (postId: string, userId: string) => void;
  unlikePost: (postId: string, userId: string) => void;
  addComment: (postId: string, comment: any) => void;
}

const PostContext = createContext<PostContextType | undefined>(undefined);

export const PostProvider = ({ children }: { children: ReactNode }) => {
  const [posts, setPosts] = useState<Post[]>([]);

  const addPost = (post: Post) => {
    setPosts((prevPosts) => {
      // Safety check: ensure prevPosts is an array
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];

      const newId = post?._id?.toString?.() ?? String(post?._id);
      if (!newId) return safeArray;

      // Prevent duplicates
      const withoutDup = safeArray.filter((p) => {
        const pId = p?._id?.toString?.() ?? String(p?._id);
        return pId && pId !== newId;
      });

      // Maintain "3 newest posts per user" rule (like web/mobile FeedScreen used to do)
      const newAuthorId =
        (post as any)?.postedBy?._id?.toString?.() ??
        (post as any)?.postedBy?.toString?.() ??
        null;

      if (!newAuthorId) {
        // If we can't identify the author, just prepend safely
        const updated = [post, ...withoutDup];
        // Sort newest first by updatedAt/createdAt to match backend behavior
        updated.sort((a: any, b: any) => {
          const dateA = new Date((a as any).updatedAt || a.createdAt).getTime();
          const dateB = new Date((b as any).updatedAt || b.createdAt).getTime();
          return dateB - dateA;
        });
        return updated;
      }

      const fromSameAuthor: any[] = [];
      const fromOtherAuthors: any[] = [];
      withoutDup.forEach((p: any) => {
        const authorId = p?.postedBy?._id?.toString?.() ?? p?.postedBy?.toString?.();
        if (authorId === newAuthorId) fromSameAuthor.push(p);
        else fromOtherAuthors.push(p);
      });

      fromSameAuthor.sort((a: any, b: any) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });

      const keptSameAuthor = fromSameAuthor.slice(0, 2); // new post becomes #1, keep 2 older = 3 total
      const updated = [post, ...keptSameAuthor, ...fromOtherAuthors];

      // Sort newest first by updatedAt/createdAt to match backend behavior
      updated.sort((a: any, b: any) => {
        const dateA = new Date((a as any).updatedAt || a.createdAt).getTime();
        const dateB = new Date((b as any).updatedAt || b.createdAt).getTime();
        return dateB - dateA;
      });

      return updated;
    });
  };

  const updatePost = (postId: string, updates: Partial<Post>) => {
    setPosts((prevPosts) => {
      // Safety check: ensure prevPosts is an array
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      return safeArray.map((post) =>
        post._id === postId ? { ...post, ...updates } : post
      );
    });
  };

  const deletePost = (postId: string) => {
    setPosts((prevPosts) => {
      // Safety check: ensure prevPosts is an array
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      return safeArray.filter((post) => post._id !== postId);
    });
  };

  const likePost = (postId: string, userId: string) => {
    setPosts((prevPosts) => {
      // Safety check: ensure prevPosts is an array
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      return safeArray.map((post) =>
        post._id === postId
          ? { ...post, likes: [...(post.likes || []), userId] }
          : post
      );
    });
  };

  const unlikePost = (postId: string, userId: string) => {
    setPosts((prevPosts) => {
      // Safety check: ensure prevPosts is an array
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      return safeArray.map((post) =>
        post._id === postId
          ? { ...post, likes: (post.likes || []).filter((id) => id !== userId) }
          : post
      );
    });
  };

  const addComment = (postId: string, comment: any) => {
    setPosts((prevPosts) => {
      // Safety check: ensure prevPosts is an array
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      return safeArray.map((post) =>
        post._id === postId
          ? { ...post, replies: [...(post.replies || []), comment] }
          : post
      );
    });
  };

  return (
    <PostContext.Provider
      value={{
        posts,
        setPosts,
        addPost,
        updatePost,
        deletePost,
        likePost,
        unlikePost,
        addComment,
      }}
    >
      {children}
    </PostContext.Provider>
  );
};

export const usePost = () => {
  const context = useContext(PostContext);
  if (!context) {
    throw new Error('usePost must be used within PostProvider');
  }
  return context;
};
