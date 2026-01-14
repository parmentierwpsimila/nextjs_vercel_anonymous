import axios from "axios";
import cos from  "cos-nodejs-sdk-v5" ;
import stream  from 'stream';
export default async function handler(req, res) {
  // 处理 CORS 预检请求
  if (req.method === "OPTIONS") {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // 只允许 POST 请求
  if (req.method !== "POST") {
    // 为错误响应也设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({
      success: false,
      message: "Method Not Allowed"
    });
  }

  // 为所有响应设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { body } = req;

  // 验证必需字段
  if (!body.email) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: type and email are required"
    });
  }


  const user_email = body.email;

  // 企业微信 Webhook URL
  const tencent_webhook =
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=a4d9df92-14dd-4d90-8f37-4f4ac46662a3";

  let markdownContent = user_email+"取消newsletter订阅";


  try {
    // 准备企业微信消息数据
    const mst_data = {
      msgtype: "markdown",
      markdown: {
        content: markdownContent
      },
    };

    // 使用 axios 发送 POST 请求到企业微信 Webhook
    const response = await axios.post(tencent_webhook, mst_data);



    let comment_json = {
      cancel_subscribe: 1,
      user_email: user_email,
    }
    let json_str = JSON.stringify(comment_json)

    //这个是在vercel中的setting中设置的
    const secretId =  process.env.COS_KEY;
    const secretKey =  process.env.COS_SECRET;
    const bucket = 'webtool-1254457405'; // 替换为您的存储桶名称
    const region = 'ap-singapore';

    const cosInstance = new cos({
      SecretId: secretId,
      SecretKey: secretKey
    });

    // 生成随机字符串
    const randomString = Math.random().toString(36).substring(2, 12);

    // 获取当前日期
    const currentDate = new Date().toISOString().slice(0, 10);

    // 构造文件名
    const fileName = `/grayscaleinsight/emails/${currentDate}_${randomString}.txt`;

    // 要上传的字符串内容
    const stringToUpload = json_str;

    // 将字符串写入临时文件
    // 创建可读流
    const readableStream = new stream.Readable();
    readableStream.push(stringToUpload);
    readableStream.push(null);


    try {
      await cosInstance.putObject({
        Bucket: bucket,
        Region: region,
        Key: fileName,
        Body: readableStream
      });

      console.log('上传成功:', `https://${bucket}.cos.${region}.myqcloud.com/${fileName}`);
      res.status(200).json({ result: 1 });
    } catch (err) {
      console.error('上传失败:', err);
      res.status(499).json({ result: 0, message: '未知原因导致失败' });
    }

    // 返回成功响应给客户端
    return res.status(200).json({
      success: true,
      message: responseMessage,
      data: {
        email: user_email,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message);

    // 根据错误类型返回不同的响应
    if (error.response) {
      return res.status(502).json({
        success: false,
        message: "Webhook service error",
        error: error.response.data
      });
    } else if (error.request) {
      return res.status(504).json({
        success: false,
        message: "Webhook request timeout",
        error: "No response received from webhook service"
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
}