import "dotenv/config";
import { Request } from 'express';

import multerS3 from 'multer-s3';
import multer from 'multer';

import { S3ClientConfigType, GetObjectCommand } from '@aws-sdk/client-s3'
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

class UploadToS3 {
    // No credentials block: the AWS SDK auto-loads them from the environment
    // (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY), 
    // the advantage of auto-load is you can use an IAM role on AWS infra.
    config: S3ClientConfigType = {
        region: 'us-east-2',
    }

    bucket = 'phuyenenglish';

    s3 = new S3Client(this.config);

    // Generate a temporary signed URL to READ/play an object (e.g. an uploaded
    // recording). `key` is the S3 object key (req.file.key from multer-s3).
    // expiresIn is in seconds (default 1 hour).
    getPresignedUrl = async (key: string, expiresIn = 3600): Promise<string> => {
        const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
        return getSignedUrl(this.s3, command, { expiresIn });
    };

    upload = multer({
        limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB cap
        storage: multerS3({
            s3: this.s3,
            bucket: this.bucket,
            contentType: multerS3.AUTO_CONTENT_TYPE,
            key: (req: Request, file, cb) => {
                console.log("file. name.", file.originalname)
                const obj = JSON.parse(JSON.stringify(req.body));
                cb(null, obj.s3_file_path + "/" + file.originalname);
            }
        })
    });
};

export default new UploadToS3();
