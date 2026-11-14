import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { RadarScreen } from "@/screens/radar-screen";

export default function RadarRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <RadarScreen />
    </HostRouteBootstrapBoundary>
  );
}
