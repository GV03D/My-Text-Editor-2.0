// js/state.js
export const CURRENT_USER_ID = "currentUser";
export const CURRENT_USER_NAME = "Иван Иванов";

let documents = [
    {
        id: 1,
        title: "Новый документ",
        contentBlocks: [{ id: 1, type: 'p', html: '' }],
        keywords: "новый документ",
        comments: []
    }
];
let nextDocId = 2;
let activeDocId = 1;

let nextBlockId = 2;
let nextCommentIdGlobal = 1;
let nextReplyIdGlobal = 1;

let selectedBlockIds = new Set();
let selectionAnchorId = null;
let selectionFocusId = null;
let selectAllState = 0;
let isSelectingArea = false;
let selectionRectStartX = 0;
let selectionRectStartY = 0;
let isMouseSelectingText = false;
let lastCursorXPosition = null;
let lastUsedColorValue = null;
let lastUsedColorType = null;

export function getDocuments() {
    return documents;
}

export function getDocumentById(id) {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) return undefined;
    return documents.find(d => d.id === numericId);
}

export function addDocument(doc) {
    const docToAdd = {
        ...doc,
        comments: (Array.isArray(doc.comments) ? doc.comments : []).map(comment => ({
            ...comment,
            replies: (Array.isArray(comment.replies) ? comment.replies : []).map(reply => ({
                ...reply,
                id: reply.id || getNextReplyId(comment.id),
                reactions: Array.isArray(reply.reactions) ? reply.reactions : []
            })),
            reactions: Array.isArray(comment.reactions) ? comment.reactions : []
        }))
    };
    if (!documents.some(d => d.id === docToAdd.id)) {
        documents.push(docToAdd);
    }
}

export function removeDocument(id) {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) return false;
    const initialLength = documents.length;
    documents = documents.filter(d => d.id !== numericId);
    return documents.length < initialLength;
}

export function updateDocument(id, updatedData) {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) return false;
    const docIndex = documents.findIndex(d => d.id === numericId);
    if (docIndex > -1) {
        const existingDoc = documents[docIndex];
        let newComments = existingDoc.comments;

        if (updatedData.comments !== undefined) {
            newComments = (Array.isArray(updatedData.comments) ? updatedData.comments : []).map(newComment => {
                const existingCommentMatch = existingDoc.comments.find(c => c.id === newComment.id);
                return {
                    ...newComment,
                    replies: (Array.isArray(newComment.replies) ? newComment.replies : (existingCommentMatch?.replies || [])).map(newReply => {
                        const existingReplyMatch = existingCommentMatch?.replies?.find(r => r.id === newReply.id);
                        return {
                            ...newReply,
                            id: newReply.id || getNextReplyId(newComment.id),
                            reactions: Array.isArray(newReply.reactions) ? newReply.reactions : (existingReplyMatch?.reactions || [])
                        };
                    }),
                    reactions: Array.isArray(newComment.reactions) ? newComment.reactions : (existingCommentMatch?.reactions || [])
                };
            });
        }

        documents[docIndex] = {
            ...existingDoc,
            ...updatedData,
            comments: newComments
        };

        if (updatedData.title !== undefined) {
             documents[docIndex].keywords = updatedData.title.toLowerCase();
        }
        return true;
    }
    return false;
}

export function updateDocumentContentBlocks(id, newContentBlocks) {
    return updateDocument(id, { contentBlocks: newContentBlocks });
}

export function getNextDocIdAndIncrement() {
    const currentId = nextDocId;
    nextDocId++;
    return currentId;
}

export function getActiveDocId() {
    return activeDocId;
}

export function setActiveDocId(id) {
    const numericId = id === null ? null : parseInt(id, 10);
     if (numericId === null || !isNaN(numericId)) {
        activeDocId = numericId;
     }
}

export function getNextBlockIdAndIncrement() {
    const currentId = nextBlockId;
    nextBlockId++;
    return currentId;
}

export function setNextBlockId(value) {
     if (typeof value === 'number' && value >= nextBlockId) {
         nextBlockId = value;
     }
}

export function getSelectedBlockIds() { return new Set(selectedBlockIds); }
export function addSelectedBlockId(id) { selectedBlockIds.add(String(id)); }
export function removeSelectedBlockId(id) { selectedBlockIds.delete(String(id)); }
export function clearSelectedBlockIds() { selectedBlockIds.clear(); selectionAnchorId = null; selectionFocusId = null; setSelectAllState(0); }
export function hasSelectedBlockId(id) { return selectedBlockIds.has(String(id)); }
export function getSelectionAnchorId() { return selectionAnchorId; }
export function setSelectionAnchorId(id) { selectionAnchorId = id === null ? null : String(id); }
export function getSelectionFocusId() { return selectionFocusId; }
export function setSelectionFocusId(id) { selectionFocusId = id === null ? null : String(id); }
export function getSelectAllState() { return selectAllState; }
export function setSelectAllState(state) { if ([0, 1, 2].includes(state)) { selectAllState = state; } }
export function getIsSelectingArea() { return isSelectingArea; }
export function setIsSelectingArea(value) { isSelectingArea = !!value; }
export function getSelectionRectStart() { return { x: selectionRectStartX, y: selectionRectStartY }; }
export function setSelectionRectStart(x, y) { selectionRectStartX = x; selectionRectStartY = y; }
export function getIsMouseSelectingText() { return isMouseSelectingText; }
export function setIsMouseSelectingText(value) { isMouseSelectingText = !!value; }
export function getLastCursorXPosition() { return lastCursorXPosition; }
export function setLastCursorXPosition(pos) { lastCursorXPosition = pos; }
export function getLastUsedColor() { return { value: lastUsedColorValue, type: lastUsedColorType }; }
export function setLastUsedColor(value, type) { if (value && type && value !== 'inherit' && value !== 'transparent') { lastUsedColorValue = value; lastUsedColorType = type; } }

export function getNextCommentId() {
    const newId = `comment-${nextCommentIdGlobal++}`;
    return newId;
}

export function getNextReplyId(parentCommentId) {
    const newId = `reply-${nextReplyIdGlobal++}`;
    return newId;
}

export function addCommentToState(commentData) {
    const currentDocId = getActiveDocId();
    if (currentDocId === null) return false;
    const doc = getDocumentById(currentDocId);
    if (!doc) return false;
    if (!Array.isArray(doc.comments)) doc.comments = [];
    if (doc.comments.some(c => c.id === commentData.id)) return false;

    const commentToSave = {
        ...commentData,
        docId: currentDocId,
        replies: (Array.isArray(commentData.replies) ? commentData.replies : []).map(reply => ({
            ...reply,
            id: reply.id || getNextReplyId(commentData.id),
            reactions: Array.isArray(reply.reactions) ? reply.reactions : []
        })),
        reactions: Array.isArray(commentData.reactions) ? commentData.reactions : []
    };
    doc.comments.push(commentToSave);
    return true;
}

export function getCommentsForDoc(docId) {
    if (docId === null) return [];
    const doc = getDocumentById(docId);
    return (doc && Array.isArray(doc.comments) ? doc.comments : []).map(comment => ({
        ...comment,
        replies: (Array.isArray(comment.replies) ? comment.replies : []).map(reply => ({
            ...reply,
            id: reply.id || getNextReplyId(comment.id),
            reactions: Array.isArray(reply.reactions) ? reply.reactions : []
        })),
        reactions: Array.isArray(comment.reactions) ? comment.reactions : []
    }));
}

export function getCommentById(commentId) {
    const currentDocId = getActiveDocId();
    if (currentDocId === null) return undefined;
    const doc = getDocumentById(currentDocId);
    if (!doc || !Array.isArray(doc.comments)) return undefined;

    const foundComment = doc.comments.find(c => String(c.id) === String(commentId));
    if (foundComment) {
        if (!Array.isArray(foundComment.reactions)) foundComment.reactions = [];
        if (Array.isArray(foundComment.replies)) {
            foundComment.replies = foundComment.replies.map(reply => {
                if (!reply.id) {
                    console.error(`[State - getCommentById] Ответ найден без ID в комментарии ${foundComment.id}. Присваивается новый. Исходные данные ответа:`, JSON.stringify(reply));
                    return {
                        ...reply,
                        id: getNextReplyId(foundComment.id),
                        reactions: Array.isArray(reply.reactions) ? reply.reactions : []
                    };
                }
                return {
                    ...reply,
                    id: reply.id,
                    reactions: Array.isArray(reply.reactions) ? reply.reactions : []
                };
            });
        } else {
            foundComment.replies = [];
        }
    }
    return foundComment;
}

export function deleteCommentFromState(commentId) {
    const currentDocId = getActiveDocId();
    if (currentDocId === null) return false;
    const doc = getDocumentById(currentDocId);
    if (!doc || !Array.isArray(doc.comments)) return false;
    const initialLength = doc.comments.length;
    doc.comments = doc.comments.filter(c => String(c.id) !== String(commentId));
    return doc.comments.length < initialLength;
}

export function addReplyToState(parentCommentId, replyData) {
    const parentComment = getCommentById(parentCommentId);
    if (!parentComment) {
        console.error(`[State LOG - addReplyToState] Родительский комментарий "${parentCommentId}" не найден.`);
        return false;
    }
    if (!Array.isArray(parentComment.replies)) {
        parentComment.replies = [];
    }
    const newReply = {
        ...replyData,
        id: replyData.id || getNextReplyId(parentCommentId),
        reactions: Array.isArray(replyData.reactions) ? replyData.reactions : []
    };
    parentComment.replies.push(newReply);
    return true;
}

export function updateCommentInState(commentId, updatedData) {
    const currentDocId = getActiveDocId();
    if (currentDocId === null) return false;
    const doc = getDocumentById(currentDocId);
    if (!doc || !Array.isArray(doc.comments)) return false;
    const commentIndex = doc.comments.findIndex(c => String(c.id) === String(commentId));
    if (commentIndex === -1) return false;

    const existingComment = doc.comments[commentIndex];
    const { id: existingId, docId: existingDocId, reactions: existingReactions, replies: existingReplies, ...restOfExisting } = existingComment;
    const { id: newId, docId: newDocId, reactions: newReactionsData, replies: newRepliesData, ...dataToUpdate } = updatedData;

    let finalReplies = Array.isArray(existingReplies) ? existingReplies : [];
    if (newRepliesData !== undefined) {
        finalReplies = (Array.isArray(newRepliesData) ? newRepliesData : []).map(newReply => {
            const existingReplyMatch = existingReplies.find(r => r.id === newReply.id);
            return {
                ...newReply,
                id: newReply.id || getNextReplyId(existingId),
                reactions: Array.isArray(newReply.reactions) ? newReply.reactions : (existingReplyMatch?.reactions || [])
            };
        });
    }

    const finalReactions = newReactionsData !== undefined ? (Array.isArray(newReactionsData) ? newReactionsData : []) : (Array.isArray(existingReactions) ? existingReactions : []);

    doc.comments[commentIndex] = {
        ...restOfExisting,
        ...dataToUpdate,
        id: existingId,
        docId: existingDocId,
        replies: finalReplies,
        reactions: finalReactions
    };
    return true;
}

export function addReactionToCommentInState(commentId, emoji, userId = CURRENT_USER_ID) {
    const comment = getCommentById(commentId);
    if (!comment) return false;
    if (!Array.isArray(comment.reactions)) comment.reactions = [];
    let emojiReaction = comment.reactions.find(r => r.emoji === emoji);
    if (emojiReaction) {
        if (!Array.isArray(emojiReaction.users)) emojiReaction.users = [];
        if (!emojiReaction.users.includes(userId)) {
            emojiReaction.users.push(userId);
        }
    } else {
        comment.reactions.push({ emoji: emoji, users: [userId] });
    }
    return true;
}

export function removeReactionFromCommentInState(commentId, emoji, userId = CURRENT_USER_ID) {
    const comment = getCommentById(commentId);
    if (!comment || !Array.isArray(comment.reactions)) return false;
    const emojiReactionIndex = comment.reactions.findIndex(r => r.emoji === emoji);
    if (emojiReactionIndex !== -1) {
        const emojiReaction = comment.reactions[emojiReactionIndex];
        if (!Array.isArray(emojiReaction.users)) return false;
        const userIndex = emojiReaction.users.indexOf(userId);
        if (userIndex !== -1) {
            emojiReaction.users.splice(userIndex, 1);
            if (emojiReaction.users.length === 0) {
                comment.reactions.splice(emojiReactionIndex, 1);
            }
            return true;
        }
    }
    return false;
}

export function addReactionToReplyInState(commentId, replyId, emoji, userId = CURRENT_USER_ID) {
    const comment = getCommentById(commentId);
    if (!comment || !Array.isArray(comment.replies)) {
        return false;
    }
    const reply = comment.replies.find(r => r.id === replyId);
    if (!reply) {
        return false;
    }
    if (!Array.isArray(reply.reactions)) {
        reply.reactions = [];
    }

    let emojiReaction = reply.reactions.find(r => r.emoji === emoji);
    if (emojiReaction) {
        if (!Array.isArray(emojiReaction.users)) emojiReaction.users = [];
        if (!emojiReaction.users.includes(userId)) {
            emojiReaction.users.push(userId);
        }
    } else {
        reply.reactions.push({ emoji: emoji, users: [userId] });
    }
    return true;
}

export function removeReactionFromReplyInState(commentId, replyId, emoji, userId = CURRENT_USER_ID) {
    const comment = getCommentById(commentId);
    if (!comment || !Array.isArray(comment.replies)) {
        return false;
    }
    const reply = comment.replies.find(r => r.id === replyId);
    if (!reply || !Array.isArray(reply.reactions)) {
        return false;
    }

    const emojiReactionIndex = reply.reactions.findIndex(r => r.emoji === emoji);
    if (emojiReactionIndex !== -1) {
        const emojiReaction = reply.reactions[emojiReactionIndex];
        if (!Array.isArray(emojiReaction.users)) return false;

        const userIndex = emojiReaction.users.indexOf(userId);
        if (userIndex !== -1) {
            emojiReaction.users.splice(userIndex, 1);
            if (emojiReaction.users.length === 0) {
                reply.reactions.splice(emojiReactionIndex, 1);
            }
            return true;
        } else {
            return false;
        }
    }
    return false;
}