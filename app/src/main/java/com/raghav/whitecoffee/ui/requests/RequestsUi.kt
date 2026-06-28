package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import android.widget.ImageView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.bumptech.glide.Glide
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.MsIcon
import com.raghav.whitecoffee.ui.theme.WcColors

/** Top bar + offline banner + scrollable padded body for the request/transfer/work forms. */
@Composable
fun RequestScaffold(
    title: String,
    onBack: () -> Unit,
    isOnline: Boolean,
    body: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().background(WcColors.ScreenBg).verticalScroll(rememberScrollState()),
    ) {
        if (!isOnline) {
            Box(Modifier.fillMaxWidth().background(Color(0xFF78350F)).padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
                Text("No internet connection", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 48.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(42.dp).clip(CircleShape).clickable { onBack() }, contentAlignment = Alignment.Center) {
                MsIcon(Ms.arrow_back, 24.sp, Color(0xFF16201F))
            }
            Spacer(Modifier.width(6.dp))
            Text(title, color = WcColors.TextPrimary, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold)
        }
        Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 32.dp)) { body() }
    }
}

/** Add-photo tile + Glide thumbnails with a remove badge. */
@Composable
fun PhotoStrip(uris: List<Uri>, onAdd: () -> Unit, onRemove: (Uri) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(
            modifier = Modifier.size(74.dp).clip(RoundedCornerShape(14.dp))
                .border(1.5.dp, WcColors.DashBorder, RoundedCornerShape(14.dp)).clickable { onAdd() },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            MsIcon(Ms.photo_camera, 22.sp, Color(0xFF6B7878))
            Text("Add", color = Color(0xFF6B7878), fontSize = 9.sp, fontWeight = FontWeight.Bold)
        }
        uris.forEach { uri ->
            Box(Modifier.size(74.dp)) {
                Box(Modifier.fillMaxSize().clip(RoundedCornerShape(14.dp)).background(Color(0xFFE4ECEC))) {
                    AndroidView(
                        factory = { ctx -> ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP } },
                        update = { iv -> Glide.with(iv).load(uri).centerCrop().into(iv) },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
                Box(
                    modifier = Modifier.align(Alignment.TopEnd).padding(3.dp).size(20.dp).clip(CircleShape)
                        .background(Color(0xCC000000)).clickable { onRemove(uri) },
                    contentAlignment = Alignment.Center,
                ) { MsIcon(Ms.close, 14.sp, Color.White) }
            }
        }
    }
}
