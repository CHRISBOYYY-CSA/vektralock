const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/auth');
const requireAdmin = require('../middleware/admin');

const router = express.Router();

// --- Local disk storage (Phase 1/2). Phase 3 swaps this for S3 upload logic,
// but the routes/response shapes below stay the same so nothing downstream breaks. ---
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB cap — adjust as needed
  // Any file type is allowed per project requirements, so no fileFilter here.
});

// POST /api/files/upload  (requires auth, multipart/form-data, field name "file")
// optional body field: category
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded (expected field name "file")' });
    }

    const file = await prisma.file.create({
      data: {
        filename: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        category: req.body.category || 'general',
        ownerId: req.user.id,
      },
    });

    res.status(201).json({ file });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Something went wrong during upload' });
  }
});

// GET /api/files  (requires auth) — lists the logged-in user's own files
// optional query params: ?search=name&category=xyz
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, category } = req.query;

    const files = await prisma.file.findMany({
      where: {
        ownerId: req.user.id,
        ...(search && { filename: { contains: search, mode: 'insensitive' } }),
        ...(category && { category }),
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ files });
  } catch (err) {
    console.error('List files error:', err);
    res.status(500).json({ error: 'Something went wrong fetching files' });
  }
});

// GET /api/files/:id/download  (requires auth, must own the file or be admin)
router.get('/:id/download', requireAuth, async (req, res) => {
  try {
    const file = await prisma.file.findUnique({ where: { id: Number(req.params.id) } });

    if (!file) return res.status(404).json({ error: 'File not found' });
    if (file.ownerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'You do not have access to this file' });
    }

    const filePath = path.join(UPLOAD_DIR, file.storedName);
    res.download(filePath, file.filename);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Something went wrong during download' });
  }
});

// POST /api/files/:id/share  (requires auth, owner only)
// Generates a temporary share link that works without auth for 1 hour.
router.post('/:id/share', requireAuth, async (req, res) => {
  try {
    const file = await prisma.file.findUnique({ where: { id: Number(req.params.id) } });

    if (!file) return res.status(404).json({ error: 'File not found' });
    if (file.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Only the file owner can create a share link' });
    }

    const shareToken = crypto.randomBytes(24).toString('hex');
    const shareExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.file.update({
      where: { id: file.id },
      data: { shareToken, shareExpires },
    });

    res.json({ shareUrl: `/api/files/shared/${shareToken}`, expiresAt: shareExpires });
  } catch (err) {
    console.error('Share link error:', err);
    res.status(500).json({ error: 'Something went wrong creating the share link' });
  }
});

// GET /api/files/shared/:token  (NO auth required — this is the public temporary link)
router.get('/shared/:token', async (req, res) => {
  try {
    const file = await prisma.file.findUnique({ where: { shareToken: req.params.token } });

    if (!file || !file.shareExpires || file.shareExpires < new Date()) {
      return res.status(410).json({ error: 'This share link is invalid or has expired' });
    }

    const filePath = path.join(UPLOAD_DIR, file.storedName);
    res.download(filePath, file.filename);
  } catch (err) {
    console.error('Shared download error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// GET /api/files/all  (requires auth + admin) — see every user's files
router.get('/admin/all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const files = await prisma.file.findMany({
      include: { owner: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ files });
  } catch (err) {
    console.error('Admin list error:', err);
    res.status(500).json({ error: 'Something went wrong fetching all files' });
  }
});

module.exports = router;
