import { Router, type IRouter } from "express";
import healthRouter from "./health";
import operatorsRouter from "./operators";
import terminalsRouter from "./terminals";
import bookingsRouter from "./bookings";
import analyticsRouter from "./analytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(operatorsRouter);
router.use(terminalsRouter);
router.use(bookingsRouter);
router.use(analyticsRouter);

export default router;
