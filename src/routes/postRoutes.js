const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/', postController.getPosts);
router.get('/:id/comments', postController.getComments);

router.post('/', verifyToken, postController.createPost);
router.post('/:id/like', verifyToken, postController.toggleLikePost);
router.post('/:id/comments', verifyToken, postController.addComment);

module.exports = router;