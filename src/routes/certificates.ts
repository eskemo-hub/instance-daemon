import { Router, Request, Response } from 'express';
import { CertificateService } from '../services/certificate.service';

const router = Router();
const certificateService = new CertificateService();

/**
 * GET /certificates/:instanceName/ca
 * Download CA certificate for a database instance
 * Clients need this to verify the server's certificate
 */
router.get('/:instanceName/ca', async (req: Request, res: Response): Promise<void> => {
  try {
    const { instanceName } = req.params;

    const caCert = certificateService.getCACertificateContent(instanceName);

    if (!caCert) {
      res.status(404).json({
        success: false,
        error: 'Certificate not found for this instance'
      });
      return;
    }

    // Return as downloadable file
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', `attachment; filename="${instanceName}-ca.crt"`);
    res.send(caCert);
  } catch (error) {
    console.error('Error retrieving certificate:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
