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
  cardGameData?: string; // JSON string containing card game data
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
    if (!postId) {
      console.warn('⚠️ [PostContext] deletePost called with empty postId');
      return;
    }
    
    setPosts((prevPosts) => {
      // Safety check: ensure prevPosts is an array
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      const beforeCount = safeArray.length;
      
      // Normalize the target postId
      const targetIdStr = postId?.toString?.() ?? String(postId);
      
      const filtered = safeArray.filter((post) => {
        // Normalize post._id for comparison - handle multiple formats
        let postIdStr = '';
        if (post._id) {
          if (typeof post._id === 'string') {
            postIdStr = post._id.trim();
          } else if (post._id.toString) {
            postIdStr = post._id.toString().trim();
          } else {
            postIdStr = String(post._id).trim();
          }
        } else {
          postIdStr = String(post._id).trim();
        }
        
        // Normalize target ID
        let normalizedTarget = targetIdStr;
        if (typeof normalizedTarget !== 'string') {
          if (normalizedTarget?.toString) {
            normalizedTarget = normalizedTarget.toString();
          } else {
            normalizedTarget = String(normalizedTarget);
          }
        }
        normalizedTarget = normalizedTarget.trim();
        
        // Compare (exact match, case-sensitive for MongoDB ObjectIds)
        const matches = postIdStr === normalizedTarget;
        
        // Log if we found a match
        if (matches) {
          console.log(`✅ [PostContext] Found matching post to delete: "${postIdStr}" === "${normalizedTarget}"`);
        } else {
          // Log first non-match for debugging
          if (safeArray.indexOf(post) === 0) {
            console.log(`🔍 [PostContext] Comparing: feed post ID="${postIdStr}" (type: ${typeof post._id}) vs target="${normalizedTarget}" (type: ${typeof targetIdStr})`);
          }
        }
        
        return !matches;
      });
      
      const afterCount = filtered.length;
      const deletedCount = beforeCount - afterCount;
      
      if (deletedCount > 0) {
        console.log(`✅ [PostContext] Deleted ${deletedCount} post(s) with ID ${targetIdStr} from feed (${beforeCount} -> ${afterCount} posts)`);
      } else {
        const availableIds = safeArray.map(p => {
          if (typeof p._id === 'string') return p._id;
          if (p._id?.toString) return p._id.toString();
          return String(p._id);
        });
        console.log(`ℹ️ [PostContext] Post "${targetIdStr}" not found in feed (${beforeCount} posts).`);
        console.log(`ℹ️ [PostContext] Available post IDs:`, availableIds);
        console.log(`ℹ️ [PostContext] Looking for:`, targetIdStr);
        console.log(`ℹ️ [PostContext] Post details:`, safeArray.map(p => {
          const postIdStr = typeof p._id === 'string' ? p._id : (p._id?.toString?.() ?? String(p._id));
          return { 
            _id: p._id, 
            _idType: typeof p._id,
            _idString: postIdStr,
            _idMatches: postIdStr === targetIdStr,
            text: p.text?.substring(0, 50),
            hasCardGameData: !!p.cardGameData
          };
        }));
        
        // Fallback: Try to find by cardGameData.roomId if it's a card game post
        // This helps when the post ID format doesn't match but we know the roomId
        const cardGamePosts = safeArray.filter(p => p.cardGameData);
        if (cardGamePosts.length > 0) {
          console.log(`🔍 [PostContext] Found ${cardGamePosts.length} card game post(s) in feed, checking if any should be deleted...`);
        }
      }
      
      return filtered;
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
