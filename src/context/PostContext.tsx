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
      return [post, ...safeArray];
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
