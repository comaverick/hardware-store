import { useEffect, useRef, useState } from "react";

import {
  CameraOutlined,
  CheckCircleFilled,
  LockOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";

import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";

import api from "../../services/api";
import "./ProductFinder.css";

const { Title, Text } = Typography;

const ProductFinder = () => {
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const [imageData, setImageData] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [result, setResult] = useState(null);
  const [reserveTarget, setReserveTarget] = useState(null);
  const [savingReservation, setSavingReservation] = useState(false);
  const [form] = Form.useForm();

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  useEffect(() => () => stopCamera(), []);

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 0);
    } catch (error) {
      message.error("Camera access was not granted. You can upload a photo instead.");
    }
  };

  const useImage = (file) => {
    if (!file?.type?.startsWith("image/")) {
      message.error("Choose an image file.");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      message.error("Choose an image smaller than 6 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageData(reader.result);
      setResult(null);
    };
    reader.readAsDataURL(file);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    setImageData(canvas.toDataURL("image/jpeg", 0.85));
    setResult(null);
    stopCamera();
  };

  const identifyItem = async () => {
    if (!imageData) return;
    try {
      setIdentifying(true);
      const response = await api.post("/product-finder/identify", { imageData });
      setResult(response.data);
    } catch (error) {
      message.error(error.response?.data?.message || "Could not identify this item.");
    } finally {
      setIdentifying(false);
    }
  };

  const reserveAtBranch = (product, branch, available) => {
    setReserveTarget({ product, branch, available });
    form.setFieldsValue({ quantity: 1, holdMinutes: 120, customerName: "", customerPhone: "" });
  };

  const createReservation = async (values) => {
    if (!reserveTarget) return;
    try {
      setSavingReservation(true);
      await api.post("/reservations", {
        branch: reserveTarget.branch._id,
        product: reserveTarget.product._id,
        quantity: values.quantity,
        customerName: values.customerName,
        customerPhone: values.customerPhone,
        expiresAt: new Date(Date.now() + values.holdMinutes * 60 * 1000).toISOString(),
      });
      message.success(`Reserved at ${reserveTarget.branch.name}.`);
      setReserveTarget(null);
      form.resetFields();
      setResult((current) => current && ({
        ...current,
        matches: current.matches.map((match) => match.product._id !== reserveTarget.product._id ? match : {
          ...match,
          availability: match.availability.map((item) => item.branch._id !== reserveTarget.branch._id ? item : {
            ...item,
            available: item.available - values.quantity,
          }).filter((item) => item.available > 0),
        }),
      }));
    } catch (error) {
      message.error(error.response?.data?.message || "Could not create the reservation.");
    } finally {
      setSavingReservation(false);
    }
  };

  return (
    <div className="finder-page">
      <div className="finder-header">
        <div>
          <Title level={2}>AI Product Finder</Title>
          <Text type="secondary">Photograph an item to find it in your catalogue and reserve available stock.</Text>
        </div>
        <Tag color="blue">Camera first</Tag>
      </div>

      <div className="finder-layout">
        <Card className="finder-capture-card">
          <div className="finder-capture">
            {cameraOpen ? (
              <video ref={videoRef} autoPlay playsInline className="finder-video" />
            ) : imageData ? (
              <img src={imageData} alt="Item to identify" className="finder-preview" />
            ) : (
              <div className="finder-empty-camera"><CameraOutlined /><strong>Ready to identify an item</strong><span>Use a clear photo that shows the label, brand, or shape.</span></div>
            )}
          </div>
          <input ref={fileInputRef} className="finder-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => useImage(event.target.files?.[0])} />
          <div className="finder-actions">
            {cameraOpen ? <><Button onClick={stopCamera}>Cancel</Button><Button type="primary" icon={<CameraOutlined />} onClick={capturePhoto}>Capture photo</Button></> : <><Button size="large" icon={<CameraOutlined />} onClick={openCamera}>Open camera</Button><Button size="large" icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>Upload image</Button></>}
          </div>
          {imageData && !cameraOpen && <div className="finder-identify-actions"><Button icon={<ReloadOutlined />} onClick={() => { setImageData(""); setResult(null); }}>Use another photo</Button><Button type="primary" size="large" icon={<SearchOutlined />} loading={identifying} onClick={identifyItem}>Identify item</Button></div>}
        </Card>

        <section className="finder-results">
          {identifying ? <Card className="finder-loading"><Spin size="large" /><strong>Finding the closest catalogue match…</strong><Text type="secondary">Checking live availability across branches next.</Text></Card> : !result ? <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Take a photo to search the catalogue" /></Card> : result.matches.length === 0 ? <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="We do not have a matching product in the catalogue." /><Text type="secondary">Try a clearer image of the item or its label.</Text></Card> : <><div className="finder-result-intro"><CheckCircleFilled /><div><strong>{result.description}</strong><span>Review the match before reserving stock.</span></div></div>{result.matches.map((match) => <Card className="finder-match-card" key={match.product._id}><div className="finder-match-heading"><div><Title level={4}>{match.product.name}</Title><Text type="secondary">{match.product.brand || "Hardware"} · {match.product.sku} · ₱{Number(match.product.sellingPrice).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</Text></div><Tag color={match.availability.length ? "green" : "red"}>{match.availability.length ? "Available" : "Not in stock"}</Tag></div>{match.availability.length ? <div className="finder-branches">{match.availability.map((item) => <div className="finder-branch" key={item.branch._id}><div><strong>{item.branch.name}</strong><span>{item.branch.code} · {item.available} {match.product.unit} available</span></div><Button type="primary" onClick={() => reserveAtBranch(match.product, item.branch, item.available)}>Reserve</Button></div>)}</div> : <Text type="secondary">This item is not currently available at any branch.</Text>}</Card>)}</>}
        </section>
      </div>

      <Modal title="Reserve item for pickup" open={Boolean(reserveTarget)} onCancel={() => setReserveTarget(null)} footer={null} destroyOnClose>
        {reserveTarget && <><div className="finder-reserve-summary"><strong>{reserveTarget.product.name}</strong><span>{reserveTarget.branch.name} · {reserveTarget.available} available</span></div><Form form={form} layout="vertical" onFinish={createReservation}><Form.Item name="customerName" label="Customer name" rules={[{ required: true, message: "Enter the customer name." }]}><Input autoFocus /></Form.Item><Form.Item name="customerPhone" label="Customer phone"><Input /></Form.Item><div className="finder-form-grid"><Form.Item name="quantity" label="Quantity" rules={[{ required: true }]}><InputNumber min={1} max={reserveTarget.available} className="full-width" /></Form.Item><Form.Item name="holdMinutes" label="Hold time (minutes)" rules={[{ required: true }]}><InputNumber min={15} max={10080} className="full-width" /></Form.Item></div><Button type="primary" htmlType="submit" block size="large" loading={savingReservation} icon={<LockOutlined />}>Confirm reservation</Button></Form></>}
      </Modal>
    </div>
  );
};

export default ProductFinder;
